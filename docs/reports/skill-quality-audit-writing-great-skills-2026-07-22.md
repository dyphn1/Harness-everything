# Skill Quality Audit — against `writing-great-skills` + `skill-creator`

- **評估基準**: [`mattpocock-skills/writing-great-skills`](../../../mattpocock-skills/skills/productivity/writing-great-skills/SKILL.md)（Predictability / Invocation / Information Hierarchy / Pruning / Failure Modes 框架）與 [`anthropics-skills/skill-creator`](../../../anthropics-skills/skills/skill-creator/SKILL.md)（Anatomy / Progressive Disclosure / Writing Style / Eval Loop）。
- **稽核範圍**: 本 repo 24 個 `SKILL.md`（root 層級技能 + `fable-mode/` 子技能），以及支撐路由的 `harness-everything/scripts/tier-router.js`、`scripts/installer.js`。
- **稽核方式**: 逐檔閱讀全文（非抽樣），對照兩份來源的字彙（duplication / no-op / negation / sediment / sprawl / leading word / single source of truth / progressive disclosure）逐條檢查，每個發現附檔案:行號證據。
- **不是**: 又一份「幫 Harness 打分數」的報告。`docs/reports/` 已經有三份分數式評鑑，`report-comparison-2026-07-21.md` 也已指出分數本身不太可信。這份文件只做規則對照，不打總分。

---

## 0. 先講清楚：這裡有兩套「Predictability」在打架

兩份來源與 Harness 現有風格,對「怎樣讓 Agent 行為可預測」給出了**不同答案**,而且都有實證支持:

| | `writing-great-skills` 的答案 | Harness 現有的答案 |
|---|---|---|
| 機制 | Leading words + 最小 context load + 解釋 why,讓模型「想用一致的方式」 | Skill Contract 表格 + `MUST`/`PROHIBITED` + script exit code,讓環境「физически 擋住」不一致的行為 |
| Negation 的立場 | 失敗模式——禁令會把被禁的行為拉進注意力,能正面表述就不要用禁令 | 刻意策略——`skill-style/SKILL.md` 明文要求「Use MUST, MUST NOT, ALWAYS. Do not use suggest」 |

Harness 目前這套風格不是隨便寫的:`CHANGELOG.md`/`report-comparison-2026-07-21.md` 記錄了它是**上一輪嚴厲稽核(Gemini 3.1 Pro,原始評分 2-4/10)逼出來的修正**——那份報告點名「missing Skill Contracts, brittle router」,直接促成了 commit `7b2d04f`(把 Skill Contract 表格灌進全部 25 個技能)。而且 `report-comparison` 也明確**拒絕**了「把 SKILL.md 改成結構化 YAML/JSON」的建議,理由是「`SKILL.md` 的讀者是讀 prose 的 LLM,不是 parser」——這其實跟 `writing-great-skills` 的立場一致(reference 是給模型讀的文件,不是給機器讀的 schema)。

**所以這份稽核不建議拆掉 Skill Contract 表格或改用溫和建議取代 MUST。** 那是一個已經被驗證過、有實體 exit-code 把關的機制,對於 Enforcement Gate 這一類「真正不可逆/會 silently 壞掉」的規則,`MUST` + 腳本擋門正是 `writing-great-skills` 自己說的「hard guardrail you can't phrase positively」的合法用法。下面的發現,抓的是兩套框架**都會同意是問題**的東西:重複、no-op、以及本來可以用 leading word 一句話講完卻分散重複解釋的地方。

---

## 1. 高優先級發現(有實體證據,兩套框架都會標記)

### 1.1 `install-cognitive-os` 與 `harness-everything` 逐字重複 33 行——且兩者都是「幾乎每一回合都載入」

`install-cognitive-os/SKILL.md:60-92`(§ Global Output Normalization)與 `harness-everything/SKILL.md:106-138`(§6 Always-On ADHD-Friendly Output Shaping)是同一段 7 條 ADHD 輸出規範,逐字比對後只有標題的中文副標題不同,內文 33 行完全相同(已用 `diff` 核對)。

- **對應失敗模式**: `writing-great-skills` 的 **Duplication**(違反 Single Source of Truth)——「same meaning given more than one authoritative place」。
- **為什麼嚴重**: 這不是兩個冷門技能的重複,是**兩個「Always / 每個新請求都載入」的技能**互相重複——`install-cognitive-os` 的 Trigger 寫的是「Always」,`harness-everything` 的 Trigger 寫的是「Every new user request」。這 33 行的 context load 在絕大多數回合被付兩次。
- **建議**(不在這次改動範圍內,留給你決定): 選一處作 single source(`install-cognitive-os` 更合理,因為 `harness-everything` §1 本來就寫著「you must awaken and load the principles of `install-cognitive-os`」),另一處改成一句 context pointer,例如「輸出規範見 `install-cognitive-os` §Global Output Normalization,原樣套用,不重述」。

### 1.2 同一顆技能的「這是什麼」被獨立維護在 4 個地方,其中 2 個已經對不上

一個技能「做什麼/何時觸發」這件事的 single source of truth,理論上應該是它自己的 frontmatter `description`。但實際上這句話在 Harness 裡被**手動維護 4 份副本**:

1. `<skill>/SKILL.md` frontmatter `description`
2. `harness-everything/SKILL.md` §5 Skill Registry 表格的「Activated when」欄
3. `harness-everything/scripts/tier-router.js` 裡手刻的 `recommendedGuides` 陣列字串(**不是**讀 frontmatter,是獨立寫死的英文說明)
4. `scripts/installer.js` 的互動安裝選單(讀 frontmatter,所以這個是唯一「自動」同步的)

實際已經飄移的例子——`using-git-worktrees` 在 `tier-router.js` 裡**同一支檔案內**就有兩份不同的說法:
- `tier-router.js:71`:`"Git Worktrees isolation for multi-tasking"`
- `tier-router.js:123`:`"Git Worktrees isolation for safe terminal environment testing"`

- **對應失敗模式**: **Duplication** + **Sediment**(每次改一個技能的用途,四處只改了其中一兩處,飄移只會隨時間累積,不會自己修正)。
- **這不是危言聳聽的抽象風險**——上面這個例子就是活生生已經發生的飄移,而且是在同一個檔案裡。
- **建議**: 把 frontmatter `description` 定為唯一權威來源;`tier-router.js` 與 §5 表格裡的文字改成「直接引用/緊貼 frontmatter 措辭」而不是各自重寫一句新的。新技能上線時,這應該是**一次编辑**而不是三次獨立編輯——這正是新 `skill-creator` 技能要接手負責的事(見下方 §3)。

### 1.3 `skill-style/SKILL.md` 本身有大段複製貼上——這是「教怎麼寫技能」的技能自己違反規則

`skill-style/SKILL.md:15-41` 與 `:44-60` 是同一段內容重複了兩次:兩次幾乎一樣的「Skill Contract 表格範例」,兩次一模一樣的「## 2. Tone & Voice」章節(逐句相同,只有第二次少了開頭的「### 📋 The Skill Contract Format」小標)。看得出來是編輯時複製貼上沒刪乾淨。

- **對應失敗模式**: **Duplication**,而且諷刺點在於——這是唯一一份**專門教別人怎麼寫 SKILL.md** 的技能,自己卻是全 repo 24 份文件裡重複比例最高的一份(60 行裡有 ~18 行是逐字重複)。
- **已修正**: 見本次改動,`skill-style/SKILL.md` 的重複段落已刪除(保留一份,見 diff)。

### 1.4 `docs/workflows/skill-style.md` 用三張 Mermaid 圖表達同一件事

`docs/workflows/skill-style.md` 有三張流程圖(§1 Behavior Workflow、§2 Routing Path、§3 Real-World Use Case),三張圖的核心語意其實是同一件事說三次:「發現/寫一份 SKILL.md → 檢查格式 → 不合格就修 → 存檔」。第三張圖甚至是第一張圖套上一個具體例子(`deploy-aws/SKILL.md`)。

- **對應失敗模式**: `writing-great-skills` 明確區分 **Duplication**(同一意義出現多處)跟 **Co-location** 的反面「scattering」——這裡三張圖是前者:同一個 meaning 用三種畫面重述,不是三個不同的 meaning。
- **嚴重度較低**(這份文件本身是 disclosed reference,不是每回合都載入),但如果之後要精簡,這是最容易砍的地方——留一張(Routing Path,因為它是唯一標出「跟其他技能怎麼串接」這個獨有資訊的)。

---

## 2. 中優先級發現

### 2.1 `description` 欄位的實際讀者是「人」,不是「自動觸發的 Agent」——但寫法混用兩種語氣

`scripts/installer.js:677-691` 證實:`description` 欄位真正的消費者,是 `npx ... install` 互動安裝時,一個**人類**在終端機用方向鍵勾選技能的畫面(`[Step 2/3] Select skills to install`,每個技能旁邊直接印出 `info.description`)。這個場景精確對應 `writing-great-skills` 的 **User-Invoked** 描述用法(一句給人看的摘要),而不是原生 Claude Skill 系統那種「Agent 自主觸發」的 Model-Invoked 描述(全 repo 也確實沒有任何檔案用到 `disable-model-invocation`——這個欄位在這個架構下本來就不適用,不是缺失)。

但目前 24 份 description 混用兩種語氣:
- 陳述句(給人看,一眼看懂):如 `verification-loop`("A comprehensive verification system...")、`eval-harness`("Objectively evaluates AI agent performance...")
- 觸發條件句(給自主觸發的 Agent 看):如 `using-git-worktrees`("Use when starting feature work that needs isolation...")、`environment-detection`("Use at the very beginning of the session...")

- **對應**: `writing-great-skills` 的 Invocation 分類——這不是錯,只是風格不一致。既然真正的讀者是勾選清單裡的人,陳述句(這技能是做什麼的)比觸發條件句(什麼時候該用)更適合這個介面上一眼判斷「要不要勾」。
- **建議**(留給後續統一,非本次強制修正): 新技能一律採「一句話講清楚做什麼」,觸發時機留給 body 內的 `## Triggers` 章節——多數技能其實已經這樣做(body 裡有獨立的 Triggers 小節),只是 description 沒跟著改。

### 2.2 Negation 用在「風格偏好」而非「硬性關卡」上,削弱了它在真正硬性關卡上的力道

`skill-style/SKILL.md` 明文指示全 repo 技能一律用 `MUST`/`PROHIBITED`,即使是風格性的偏好(例如「Do not write long paragraphs」)。這造成 `MUST`/`PROHIBITED` 在文件裡出現密度極高,而 `writing-great-skills` 的論點是:當禁令只用在真正不可逆、真正二元的關卡上,它才有訊噪比;用在風格偏好上,會把「這是物理擋門」跟「這是建議」的訊號攤平成同一種語氣,讀者(模型)較難分辨哪個真的不能違反。

- **已經做對的反例,值得保留當範本**: `zoom-out/SKILL.md:31-33` 的「Phase 1 — Cease Fire」——`ABSOLUTELY PROHIBITED from proposing any new code modification` 後面**立刻接一句解釋**:「that sentence is the tunnel talking」。這正是 `writing-great-skills` 建議的「pair a prohibition with the positive target / explain why」,`zoom-out` 全篇其實在「解釋 why」這件事上做得相當好(§2「Its purpose is NOT to hand the problem to the human」)。
- **值得改進的例子**: `environment-detection/SKILL.md:72-76`「Red Flags & Common Errors」用 ❌ 條列的方式,把前面「Execution Phase」章節已經用正面形式講過的規則(哪個 shell 用哪種語法),原封不動反過來再講一次「不要用錯語法」。這是本輪較輕微的 **Negation 疊 Duplication**:同一組規則,先正面講一次,再用禁止句型講第二次。

### 2.3 「MUST operate using the cognitive loop」在多個技能中重述,接近 No-Op

`build-multi-agent-system/SKILL.md:18`、`repo-docs/SKILL.md`(隱含在 `[Discover]`/`[Think]` 標記裡)、`environment-detection/SKILL.md:18` 等多處各自重申一次「MUST operate using cognitive loop: Think > Try > Summarize > Record」。`install-cognitive-os` 的 Trigger 已經寫明是「Always — loaded before any action on any task」——如果它真的每次都被載入,子技能裡再重述一次這句話就是教科書等級的 **No-Op**(模型已經在預設遵守的東西,又付一次 token 去重申)。

- **不算嚴重**,单句而非整段,而且在「`install-cognitive-os` 是否真的每次都被讀到」这个前提不完全確定的架構下(這是 hook 注入 advisory + router 手動指路的系統,不是原生一定載入),留一句輕量提醒也不算完全沒有訊息量。列在這裡是給未來的 `skill-creator`(見下方)一個具體的「這樣算不算 no-op」判準案例。

---

## 3. 這份 repo 已經做對、且比原生 Claude Skill 系統更成熟的地方

值得記錄下來,不然稽核只列缺點會失真:

- **Router Skill 模式已經自發實現,而且做得比純人力索引更好**。`writing-great-skills` 建議「user-invoked 技能一多,就做一個 router skill 幫人記」;`harness-everything/SKILL.md` §5 的 Skill Registry 正是這個模式,而且 Harness 更進一步用 `tier-router.js` 把「什麼時候該提示哪個技能」自動化,不用單靠人腦記憶——這已經超越了兩份來源預設的「純人力索引」版本。
- **Leading words 用得相當精準,且複用率高**。「Tier 1/2/3」「Rule of 3」「circuit breaker / zoom out」「Red-Green-Refactor」都是全 repo 一致複用的緊湊詞彙,`tdd`、`fable-discipline`、`improve-codebase-architecture`、`harness-everything` 提到需要中斷重來時一律只寫「trigger `zoom-out`」,不會每次重新展開整套反思流程——這正是 `writing-great-skills` 說的「a context pointer's wording decides when the agent reaches」的良好示範。
- **Progressive disclosure 的「Deep Reference Guides」模式已經穩定套用**。`git-commit`、`tdd`、`repo-docs`、`improve-codebase-architecture` 都用同一種寫法把細節推到 `guides/*.md`/`templates/*.md`,並在 SKILL.md 內用一句話說明「什麼情境該去讀哪份」——這跟 `skill-creator` 的 `references/` 慣例、`writing-great-skills` 的 External Reference 概念完全對得上。
- **Completion criteria 天生就比一般 skill 更 checkable**。因為 Enforcement Gate 綁定實體 exit code(`todo-cli.js`、`verify-gate.js`),`writing-great-skills` 擔心的「vague completion criterion invites premature completion」這個失敗模式,在 Harness 裡被架構性地繞開了——這是 Skill Contract 表格模式換來的真實優勢,不該為了追求「少寫 MUST」而放棄。

---

## 4. 修正記錄(2026-07-22,同一天稍晚)

依本報告 §1.1/§1.2/§1.4 的建議實際動手修正,並新增 `docs/workflows/skill-creator.md`:

- **§1.1 ADHD 區塊去重**: 唯一權威來源改為 `install-cognitive-os/SKILL.md` § Global Output Normalization(內容不變)。`harness-everything/SKILL.md` §6、`AGENTS.md` 的完整區塊都改成一句指向該處的 context pointer。修正過程中另外發現:這段內容原本**已經被 stage 到第三份檔案 `AGENTS.md`**(工作目錄裡未 commit 的既有變更,不是本次新增),一併修正。順手修正了 `harness-everything/SKILL.md` 裡一個指向不存在路徑 `harness-everything/adhd-output-shaping` 的壞 pointer,以及 `AGENTS.md` 標題誤植為「# Copilot Instructions」(該檔案實際是給 Codex 讀的 `AGENTS.md`)。
- **§1.2 技能說明飄移**: 逐一核對 `tier-router.js` 裡重複出現的技能(`environment-detection`、`verify-before-claim`、`verification-loop`、`using-git-worktrees`、`fable-mode`、`grill-with-docs`),把每個技能在檔案內所有出現位置的說明文字統一成同一句話。其中 `verify-before-claim` 原本在 TDD 關鍵字區塊裡的說法(「Validate test assertions with objective evidence」)是**錯的**——這技能查證的是外部框架/API 行為與未量測的估計值,跟「驗證測試斷言」無關,已改成與其 frontmatter 一致的正確說法。
- **§1.4 `skill-style.md` 三圖重複**: §1(內部稽核流程)與 §3(具體案例)原本是同一件事重述兩次;§3 改成呈現 `skill-creator` 拆分出去後兩者實際如何協作的具體流程(不同資訊,不是重述)。§2 同步更新,反映 `tier-router.js` 現在優先推薦 `skill-creator`、`skill-style` 其次的實際路由順序。
- **新增** `docs/workflows/skill-creator.md`,採用與其他 22 份 workflow 文件相同的四段式結構(Behavior Workflow / Triggering & Routing Path / Real-World Use Case / Verification Check)。

修正後重跑 `node self-evolve/scripts/self-regression.js`——Phase 1(24 個 JS 檔語法檢查)、Phase 2(5 個路由測試案例)、Phase 3(行為測試)全數通過。

## 5. 路由一致性驗證:每個技能是否都路由到 `install-cognitive-os` / `todo-driven-workflow` / `self-evolve`

逐一核對後的結論:**不應該讓 25 份技能各自重複寫一遍「記得載入這三個」**——那樣做本身就是本報告 §1.1/§1.2 剛修正掉的那種大規模重複。這三個技能目前是「單一權威來源」的正確做法,是透過 `harness-everything`(路由器)**集中宣告**,而不是要求每個技能自己重申:

| 技能 | 對應用戶說的角色 | 目前的強制範圍 | 宣告位置 | 是否需要每顆技能自己重複宣告 |
|---|---|---|---|---|
| `install-cognitive-os` | 心智體 | **無條件**——任何任務執行任何動作前都先載入 | `harness-everything/SKILL.md` §1("you must awaken and load the principles of install-cognitive-os") | 不需要——已經是無條件套用 |
| `todo-driven-workflow` | 行為準則 | **僅 Tier 2/3**——Tier 1 刻意豁免(避免瑣事也要開 checklist) | `harness-everything/SKILL.md` §1 | 不需要——`tdd`、`fable-mode` 這種本身就是 Tier 2/3 執行引擎的技能已經直接引用它(它們把自己的階段對應到 checklist 項目),`git-commit`/`rewrite-commits` 等 Tier 1 技能本來就該豁免 |
| `self-evolve` | 總結行為 | **條件觸發**——斷路器解除後或完成重大突破後,不是每次執行都觸發 | `harness-everything/SKILL.md` §4 | 不需要——`zoom-out`、`build-multi-agent-system`、`improve-codebase-architecture` 這些「真的會走到值得記錄的困難時刻」的技能已經直接引用它,其餘技能透過 §4 的全域宣告涵蓋即可 |

三個技能自己的 Skill Contract Trigger 欄位,也分別準確反映了各自的實際範圍(`install-cognitive-os` 寫「Always」、`todo-driven-workflow` 寫「Tier 2/3 Task Identification」、`self-evolve` 寫「Task completion after a major struggle, or post-zoom-out recovery」)——三者互相一致,`harness-everything` §5 Registry 表格的描述也跟這三句話對得上,沒有發現矛盾。

**結論**: 路由是一致的,但「一致」指的是「每次執行都會經過這個由 `harness-everything` 集中把關的三段式信封(心智體 → 行為準則(視 Tier)→ 總結行為(視是否有值得記的教訓))」,不是「每份 SKILL.md 都寫同一句話」。後者會製造新的 §1.1 型重複;現有架構已經是正確做法。

## 6. 沒有處理的範圍

- `security-review/SKILL.md`(508 行,全 repo 最長)只做了掃描比對關鍵詞,未逐行細讀——如果之後要精簡,它是全 repo 目前最長、最該優先看 sprawl/progressive-disclosure 的候選。
- §1.1(ADHD 區塊重複)、§1.2(技能說明飄移)、§1.4(`skill-style.md` 三圖重複)已於 §4 全部修正並驗證通過,不再是待處理項目。
