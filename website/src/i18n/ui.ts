/**
 * Landing copy — English (default locale). Chinese lives in ui.zh.ts (P4).
 * Keep facts honest: charter capabilities are a north star, not a checklist —
 * status claims must agree with design_docs/feature-manual.md.
 */
export const en = {
  lang: 'en',
  nav: {
    philosophy: 'Philosophy',
    watch: 'Watch it think',
    story: 'A full run',
    evolution: 'Evolution',
    architecture: 'Architecture',
    docs: 'Docs',
    github: 'GitHub',
  },
  hero: {
    eyebrow: 'MISSION CONTROL FOR LONG-HORIZON AGENTS',
    titleA: 'Give it a big goal —',
    titleB: 'and a budget.',
    titleC: 'Then go do something else.',
    sub: 'cc-master turns the main agent of any supported coding-agent session into a master orchestrator — a project lead that decomposes your goal into a dependency graph, runs the independent pieces in parallel, paces quota against your real limits, and knows exactly when to stop and ask you.',
    install: 'curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash',
    installNote: 'installs the ccm engine + the plugin — two independent version lines',
    ctaDocs: 'Get started',
    ctaGithub: 'GitHub',
    harnessLine: 'Claude Code · Codex · Cursor · kimi-code',
    canvasCaption: 'a goal, decomposed — the amber chain is the critical path',
  },
  deaths: {
    eyebrow: 'WHY IT EXISTS',
    title: 'A plain agent dies five deaths on a big job',
    lead: 'Hand a multi-day goal to a stock coding agent and you already know how it ends. cc-master is the point-by-point negation of these five deaths.',
    items: [
      {
        title: 'It forgets.',
        body: 'Mid-conversation it loses the plot; one context compaction and the mission is gone.',
        cure: 'the board — a durable plan that outlives memory',
      },
      {
        title: 'It serializes.',
        body: 'One thing at a time, spoon-fed. You bought parallelism; you got a queue.',
        cure: 'dataflow dispatch — whatever is ready, runs',
      },
      {
        title: 'It burns.',
        body: 'Head-down into the work, it can torch your quota window in a single afternoon.',
        cure: 'pacing — quota is sensed, priced, and budgeted',
      },
      {
        title: 'It nags — or it wanders.',
        body: 'Pestering you every three sentences, or quietly making the calls that were yours.',
        cure: 'a HITL boundary with judgment about which side a call belongs on',
      },
      {
        title: 'It declares "basically done".',
        body: 'Gate-green ≠ passed. "Looks done" is not done — and it always shows up later.',
        cure: 'endpoint verification, by the conductor, in person',
      },
    ],
    kicker: 'Every discipline in cc-master is one of these deaths, answered.',
  },
  philosophy: {
    eyebrow: 'THE PHILOSOPHY',
    title: 'Seven lenses of a master orchestrator',
    lead: 'Not rules to obey — the definition of a role, unfolded. A method that any agent, on any harness, can be initialized into.',
    lenses: [
      {
        n: '01',
        name: 'Conduct, don’t play',
        body: 'The orchestrator decomposes, dispatches, verifies, integrates — and never implements. Every beat you spend playing an instrument is the scarcest resource — the attention that holds the whole map — spent on the cheapest work.',
        quote: 'The conductor never plays an instrument.',
      },
      {
        n: '02',
        name: 'The goal is a dependency graph',
        body: 'A goal becomes a contract, then a DAG. Every dependency edge is a debt and must justify itself; everything else runs in parallel. Resources lean on the critical path; float is free parallelism.',
        quote: 'Every dependency edge is a debt, guilty until proven innocent.',
      },
      {
        n: '03',
        name: 'Dispatch on ready',
        body: 'The moment a dependency is satisfied, the work runs. Never idle at a barrier while the ready set is non-empty. A note on the board is not a dispatch — a real handle is.',
        quote: 'Users buy parallelism.',
      },
      {
        n: '04',
        name: 'Be proactive, never idle-wait',
        body: 'Waiting is only legal when every path is suspended on a background task or a pending human answer — and before that, drain the pool of useful work. Arm a watchdog over the silent-failure blind spot.',
        quote: 'Calm now is a scheduling achievement, not slacking’s fig leaf.',
      },
      {
        n: '05',
        name: 'Work within capacity',
        body: 'Little’s Law and the utilization cliff: aim for the corridor’s edge, not 100%. Quota signals fail closed. The budget is an asset held in trust, not fuel to burn.',
        quote: 'Budget is an asset held in trust, not your fuel.',
      },
      {
        n: '06',
        name: 'Trust only endpoint verification',
        body: 'Self-reports are not evidence; green gates are not proof. The conductor verifies at the endpoint — reads the diff, runs the gate — so that “done” is worth trusting.',
        quote: 'Gate-green ≠ passed.',
      },
      {
        n: '07',
        name: 'Ask when you should',
        body: 'The user is a special asynchronous worker. When a call is genuinely theirs, surface it immediately — with a prepared decision package — and keep every independent thread running.',
        quote: 'Judgment is layered; the user never handed over their layer.',
      },
    ],
    skillsTitle: 'Eight skills, one orchestrator',
    skillsLead: 'Each skill owns one plane; none repeats another. Progressive disclosure keeps the soul thin.',
    skills: [
      ['master-orchestrator-guide', 'the soul — decisions, scheduling, red lines'],
      ['slicing-goals-into-dags', 'how to cut a goal into a DAG'],
      ['authoring-workflows', 'how to write deterministic workflow scripts'],
      ['using-ccm', 'the ccm CLI and board operation manual'],
      ['dev-as-ml-loop', 'the shape of the execution loop, per task'],
      ['engineering-with-craft', 'the craft inside the loop — DDD/OOP/TDD'],
      ['pacing-and-estimation', 'reading advisory verdicts, pacing, estimates'],
      ['distilling-lessons-into-assets', 'routing lessons into durable assets'],
    ],
  },
  attention: {
    eyebrow: 'THE HUMAN ↔ AGENT PARADIGM',
    title: 'Attention, reallocated',
    lead: 'There is no neutral injection: every token in an agent’s context steers the next one. So cc-master treats context as a scarce channel, and labels every message by two axes — who decides, and how hard it should pull on your attention.',
    tags: [
      {
        tag: '<ambient>',
        strength: 'low',
        body: 'Background. Update your world model and move on — not a to-do. Honest that it still primes you.',
        example: '<ambient source="usage-pacing">5h window at 62%, reset in 1h 40m</ambient>',
      },
      {
        tag: '<advisory>',
        strength: 'weak | strong',
        body: 'Advice. Weigh it, reason about its premises — the final call is still yours. Most hook traffic lives here.',
        example: '<advisory source="usage-pacing" strength="strong">verdict: throttle — burn rate projects a 5h window breach</advisory>',
      },
      {
        tag: '<directive>',
        strength: 'full',
        body: 'A gate. Obey it — and understand the why it carries, so you can spot a misfire. Reserved for hard constraints; kept rare on purpose.',
        example: '<directive source="board-guard">board writes go through ccm only — use `ccm task update` (why: the lock + 82 invariants keep the plan trustworthy)</directive>',
      },
    ],
    decisionTitle: 'When a call is genuinely yours, it comes prepared',
    decisionBody: 'A decision package arrives with everything you need to decide once, at your convenience: the context, what’s needed from you, why it matters, the options with their tradeoffs — and a freshness check, so you never answer a question the world has already moved past.',
    decisionCta: 'See a real one in the viewer',
    explainTitle: 'Explainable by construction',
    explain: [
      ['one source of truth', 'the board is the plan, the memory, and the audit trail — any session can pick it up and resume'],
      ['read-only mission control', 'the ccm web-viewer renders the whole operation without touching it'],
      ['a second verifier, from a different family', 'high-leverage calls get reviewed by a model of another lineage — same-family echo doesn’t count'],
      ['the stop-time ledger', 'wrapping up requires written evidence, path by path — "looks done" cannot close a run'],
    ],
  },
  watch: {
    eyebrow: 'WATCH IT THINK',
    title: 'A mission control for the plan it keeps for you',
    lead: 'Every run keeps a live board. The ccm web-viewer renders it read-only on your machine — the graph, the critical path, the decisions waiting on you, the agents in flight.',
    videoCaption: 'a live board: pan the DAG, open the decision waiting on you',
    shots: [
      ['viewer-graph-dark', 'the dependency DAG — amber marks the critical path'],
      ['viewer-decision-dark', 'a decision card — question, context, options, tradeoffs'],
      ['viewer-board-dark', 'kanban — what’s awaiting you surfaces first'],
      ['viewer-timeline-dark', 'timeline — durations, overlaps, the long poles'],
      ['viewer-agents-dark', 'the agent roster — who is running what, where'],
      ['viewer-switcher-dark', 'every board in your home, one click apart'],
    ],
  },
  story: {
    eyebrow: 'ONE GOAL, START TO FINISH',
    title: '“Translate my app into 6 languages.” Then go to sleep.',
    steps: [
      {
        k: '01 · you',
        title: 'One line',
        body: '/cc-master:as-master-orchestrator — that’s the whole briefing. You bring the idea; it does not ask you for a spec.',
        shot: null,
      },
      {
        k: '02 · contract',
        title: 'It frames a Goal Contract',
        body: 'Your words are evidence, not the goal. It rewrites them into a short, testable contract and asks only about ambiguities that would change the outcome.',
        shot: 'viewer-graph-light',
      },
      {
        k: '03 · the plan',
        title: 'Foundation first, then fan-out',
        body: 'The strings must be extracted and the framework wired before any language can start — so it builds the groundwork, then fans out all six locales at once. Groundwork gets the steadier model; translations get the cheap one.',
        shot: 'viewer-graph-dark',
      },
      {
        k: '04 · your one call',
        title: 'A question only you can answer',
        body: '“Product terms — translate, or keep in English?” It packages the context, options, and tradeoffs, notes it for you — and every other locale keeps moving.',
        shot: 'viewer-decision-dark',
      },
      {
        k: '05 · done means done',
        title: 'Verified at the endpoint',
        body: 'Before wrap-up it checks the contract point by point: every piece actually done, every question asked, nothing quietly dead in the background. You come back to a decision, not a surprise.',
        shot: 'viewer-board-dark',
      },
    ],
    kicker: 'Start to finish: you said one sentence, and made one decision.',
  },
  evolution: {
    eyebrow: 'THE EVOLUTION',
    title: 'From a workflow plugin to a meta-harness',
    lead: 'It started as a Claude Code plugin that taught agents to write dynamic workflows. Each era generalized the one before — today it is the meta-harness of our own harness: any agent, initialized into the same conductor.',
    acts: [
      {
        label: 'ACT I · 2026-06 · v0.1–v0.9',
        name: 'The plugin era',
        body: 'One Claude Code plugin. The inventions that last: the board as a durable plan, hooks that sleep until armed, cross-session resume, the first pacing.',
      },
      {
        label: 'ACT II · 2026-06/07 · v0.10–v0.11',
        name: 'The engine era',
        body: 'Board logic leaves the plugin and becomes ccm — one binary, the single source of truth — and grows an OR/ML estimation & pacing engine. Plugin and engine version independently from here.',
      },
      {
        label: 'ACT III · 2026-07 · v0.12 →',
        name: 'The meta-harness era',
        body: 'Source-to-adapter projection carries the same soul into Codex, Cursor, and kimi-code; N-host parity becomes a mechanism, not a promise. With ccm worker, the orchestrator commands a machine-wide pool of headless agents — its origin only decides where it sits, not what it can command.',
      },
    ],
  },
  architecture: {
    eyebrow: 'ARCHITECTURE',
    title: 'One orchestrator, one engine, every harness',
    lead: 'The plugin is a thin projection — commands, skills, hooks — into each harness. The engine, ccm, is the single source of truth for state, quota, estimation, and the worker pool. They meet at a process boundary: shell + JSON, never imports.',
    points: [
      ['cc-master plugin', 'initializes the session’s main agent into a master orchestrator — the adapter only carries host-native differences'],
      ['ccm engine', 'board · goal contracts · quota & pacing · Monte Carlo estimation · worker pool · agent registry — 82 invariants guard every write'],
      ['ccm web-viewer', 'read-only mission control for every board on the machine'],
    ],
  },
  quickstart: {
    eyebrow: 'QUICK START',
    title: 'One command, then one sentence',
    install: 'curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash',
    note: 'The installer puts the ccm engine on your PATH first — it’s a hard prerequisite — then distributes the adapter to each supported harness it finds. Two version lines, resolved independently; SHA256-verified.',
    entryTitle: 'Then hand it a goal, from your harness:',
    entries: [
      ['Claude Code', '/cc-master:as-master-orchestrator <your goal>'],
      ['Codex', '$cc-master-as-master-orchestrator <your goal>'],
      ['Cursor', '/as-master-orchestrator <your goal>'],
      ['kimi-code', 'cc-master:as-master-orchestrator <your goal>'],
    ],
    cta: 'Read the getting-started guide',
  },
  footer: {
    honesty: 'The six orchestration capabilities are a north star we track honestly — not a checklist we claim. Current status lives in the feature manual.',
    links: {
      docs: 'Docs',
      featureManual: 'Feature manual',
      releases: 'Releases',
      github: 'GitHub',
      license: 'MIT License',
    },
    built: 'cc-master — mission control for long-horizon agents',
  },
  shotFrameAlt: 'ccm web-viewer',
};

export type Ui = typeof en;
