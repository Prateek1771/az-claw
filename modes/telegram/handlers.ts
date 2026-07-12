import type { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { isOwner } from "./auth";
import { brainConfigured } from "../brain/store";
import { enrichDump } from "../brain/enrich";
import { extractFromImage } from "../brain/vision";
import { saveDump, answerFromBrain } from "../brain/orchestrator";
import { WELCOME } from "./constants";
import { clip, commandArg } from "./text";
import { runAgent, runAsk, runPlanSteps } from "./agent-run";
import { generatePlan } from "../plan/planner";
import { planKeyboard, planMessage, planSessions, refreshPlanUi, type PlanSession } from "./plan-session";
import { approvalDiff, approvalSessions } from "./approval-session";

export function registerHandlers(bot: Telegraf) {
  bot.command("start", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    await ctx.reply(WELCOME, { parse_mode: "Markdown" });
  });

  bot.command("ask", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const q = commandArg(ctx.message.text, "ask");
    if (!q)
      return ctx.reply("Usage: `/ask <your question>`", {
        parse_mode: "Markdown",
      });

    await ctx.reply("🔍 Researching your question…");
    void runAsk(ctx, q).catch(console.error);
  });

  bot.command("agent", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const goal = commandArg(ctx.message.text, "agent");
    if (!goal)
      return ctx.reply("Usage: `/agent <task description>`", {
        parse_mode: "Markdown",
      });
    await ctx.reply("🤖 Agent is working on your task…");
    void runAgent(ctx, ctx.chat.id, goal).catch(console.error);
  });

  bot.command("plan", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const goal = commandArg(ctx.message.text, "plan");

    if (!goal)
      return ctx.reply("Usage: `/plan <your goal>`", {
        parse_mode: "Markdown",
      });

    await ctx.reply("🧭 Generating a plan…");

    void (async ()=>{
        const plan = await generatePlan(goal)
        const session:PlanSession = {plan , selected:new Set(plan.steps.map((s)=>s.id))}
        await ctx.reply(planMessage(session) , {parse_mode:"Markdown", ...planKeyboard(session)});
         planSessions.set(ctx.chat.id, session);
    })().catch(console.error)
  });

    bot.action(/^plan_toggle:(.+)$/, async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();

    const id = ctx.match[1]!;
    if (s.selected.has(id)) s.selected.delete(id);
    else s.selected.add(id);

    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

  
  bot.action('plan_all', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();
    for (const step of s.plan.steps) s.selected.add(step.id);
    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

    bot.action('plan_none', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();
    s.selected.clear();
    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

   bot.action('plan_proceed', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();

    const steps = s.plan.steps.filter((step) => s.selected.has(step.id));
    if (steps.length === 0) return ctx.answerCbQuery();

    const { plan } = s;
    planSessions.delete(ctx.chat!.id);
    const list = steps.map((step, i) => `${i + 1}. ${step.title}`).join('\n');
    await ctx.editMessageText(`🚀 Executing ${steps.length} step(s)…\n\n${list}`);
    await ctx.answerCbQuery();

    void runPlanSteps(ctx, ctx.chat!.id, plan, steps).catch(console.error);
  });

  const brainReady = (ctx: { reply: (t: string) => Promise<unknown> }) => {
    if (brainConfigured()) return true;
    void ctx.reply("⚠️ Set INSFORGE_BASE_URL and INSFORGE_ANON_KEY in .env first.");
    return false;
  };

  bot.command("dump", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const raw = commandArg(ctx.message.text, "dump");
    if (!raw)
      return ctx.reply("Usage: `/dump <anything worth remembering>`", { parse_mode: "Markdown" });
    if (!brainReady(ctx)) return;

    await ctx.reply("🧠 Saving to your brain…");
    void (async () => {
      const note = await enrichDump(raw);
      await saveDump(note);
      await ctx.reply(`✓ Saved: *${note.title}*\n_${note.tags.join(", ")}_\n\n${note.summary}`, {
        parse_mode: "Markdown",
      });
    })().catch((e) => ctx.reply(`❌ ${e instanceof Error ? e.message : e}`));
  });

  bot.command("brain", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const q = commandArg(ctx.message.text, "brain");
    if (!q)
      return ctx.reply("Usage: `/brain <question about your notes>`", { parse_mode: "Markdown" });
    if (!brainReady(ctx)) return;

    await ctx.reply("🧠 Searching your notes…");
    void (async () => {
      const answer = await answerFromBrain(q);
      await ctx.reply(clip(answer), { parse_mode: "Markdown" }).catch(() => ctx.reply(clip(answer)));
    })().catch((e) => ctx.reply(`❌ ${e instanceof Error ? e.message : e}`));
  });

  bot.on(message("photo"), async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    if (!brainReady(ctx)) return;

    await ctx.reply("🧠 Reading your image…");
    void (async () => {
      const sizes = ctx.message.photo;
      const fileId = sizes[sizes.length - 1]!.file_id; // largest rendition
      const link = await ctx.telegram.getFileLink(fileId);
      const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
      const extracted = await extractFromImage(bytes, "image/jpeg", ctx.message.caption);
      const note = await enrichDump(extracted, "image");
      await saveDump(note);
      await ctx.reply(`✓ Saved: *${note.title}*\n_${note.tags.join(", ")}_\n\n${note.summary}`, {
        parse_mode: "Markdown",
      });
    })().catch((e) => ctx.reply(`❌ ${e instanceof Error ? e.message : e}`));
  });

  bot.action('approval_diff', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    await ctx.reply(clip(approvalDiff(s.pending)));
  });

  bot.action('approval_accept', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();

    approvalSessions.delete(ctx.chat!.id);
    for (const a of s.pending) s.tracker.updateStatus(a.id, 'approved', true);
    const { errors } = s.executor.applyApprovedFromTracker();
    s.executor.clearStaging();

    await ctx.editMessageText('✅ All changes applied.');
    await ctx.answerCbQuery('Applied!');
    if (errors.length) console.error(errors);
  });

  bot.action('approval_reject', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();

    approvalSessions.delete(ctx.chat!.id);
    for (const a of s.pending) s.tracker.updateStatus(a.id, 'rejected', false);
    s.executor.clearStaging();

    await ctx.editMessageText('❌ All changes rejected. Nothing was applied.');
    await ctx.answerCbQuery('Rejected');
  });

}
