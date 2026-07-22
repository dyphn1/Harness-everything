# Harness 系統驗證與效能評估報告 (Harness System Verification & Performance Evaluation Report)

- **評估模型**: Gemini 3.5 Flash
- **評估日期**: 2026-07-21
- **評估標準**: 依據 `VERIFICATION.md` 第 5 節所定義之五大核心驗證指標，進行最嚴格、不妥協的架構審查與實測驗證。

---

## 🚦 1. 五大核心驗證指標深入評估 (Five Core Verification Criteria)

### 指標一：技能描述完整度 (Skill Description Completeness) —— **評分：9.5 / 10**
*   **優勢分析**:
    *   **高度標準化**: 所有核心技能（如 `harness-everything`、`tdd`、`zoom-out`、`self-evolve`、`environment-detection`）皆配置了統一且嚴格的 `SKILL.md` 結構。
    *   **契約明確**: 每個技能開頭均有「Skill Contract」表格，詳列 Trigger/Input、Expected Output、State Mutations 以及 Enforcement Gate，使 AI Agent 在載入時能迅速對齊邊界。
    *   **斷路器防禦完整**: 顯式定義了「Rule of 3」以及 `zoom-out` 機制，為防範 Agent 陷入死循環提供了明確的底線與操作手冊。
*   **嚴厲審查與潛在漏洞 (Shortcomings & Loop-holes)**:
    *   **物理強制與認知遵守的非對稱性**: 雖然 `Enforcement Gate` 在 `SKILL.md` 中被明確記載，但這種約束在非 Claude Code 平台（如 VS Code Copilot、Cursor）上完全依賴 Agent 的「認知遵守（Cognitive Compliance）」，缺乏物理性的沙箱攔截。若 Agent 因 Context 膨脹或注意力渙散而忽略提示，這些契約將退化為「純文字建議」。
    *   **缺乏動態技能的生命週期聲明**: `self-evolve` 中提及可以動態生成新技能，但現有的 `SKILL.md` 模板並未對「動態技能」與「系統基礎靜態技能」的優先級、生命週期（何時過期、何時重構）做出清晰的架構層面界定。

---

### 指標二：路由精準度 (Routing Accuracy) —— **評分：8.5 / 10**
*   **優勢分析**:
    *   **雙語支持避免靜態退化**: 路由機制（`tier-router.js`）支援中英文雙語關鍵字匹配（例如 `architecture` / `架構`，`test` / `測試`），確保中文 prompt 不會被錯誤地「降級」為 Tier 1。
    *   **避免 Git 殘留污染**: 路由邏輯明確排除使用當前 Git 暫存區（Diff）作為 Triage 依據，有效防止上一次任務的殘留代碼干擾本次任務的分類，這是一項極佳的防錯設計。
    *   **主動式 Fact-Audit Nudge**: 包含非常實用的事實審查提示網路，能精確捕捉「does it support」、「exit code」等觸發詞，強迫 Agent 在回答前透過網絡或文檔查證。
*   **嚴厲審查與潛在漏洞 (Shortcomings & Loop-holes)**:
    *   **純關鍵字啟發式匹配的脆弱性**: `tier-router.js` 採用扁平且簡單的 `some(k => promptLower.includes(k))` 機制。這意味著當 Prompt 包含複合語意時（例如「我想**詢問**我們的驗證**架構**，但**不需**要做任何**重構**」），會因為同時命中 `architecture` 與 `refactor` 而被強行升級為 Tier 3 (Macro Task) 並觸發 Fable-Mode，造成嚴重的 Token 浪費與流程過度工程（Over-engineering）。
    *   **缺乏語意層面的意圖解析 (Intent Parsing)**: 路由完全不具備 AST 或輕量級 LLM 預分類的能力，無法應對高模糊性、隱喻性的 Prompt（例如「這段代碼跑起來像隻烏龜」應被分類為性能 Tier 2/3，但目前的關鍵字會漏失此意圖而退化為 Tier 1）。

---

### 指標三：所有技能測試覆蓋率 (Test Coverage of All Skills) —— **評分：8.0 / 10**
*   **優勢分析**:
    *   **自動化回歸套件完整**: `self-regression.js` 實現了多階段的測試流程，包含靜態語法檢查（對 24 個 JS 文件執行 `node --check`）、路由測試（5 個測試案例）以及極具創意的行為測試（`behavioral-test.js`）。
    *   **行為測試貼近真實狀態機**: `behavioral-test.js` 模擬了 Agent 的各種非合規操作（如未 Start 即 Complete、併發 start 任務、在驗證失敗時強行 Complete），並成功驗證了 `todo-cli.js` 能精確丟出 Exit Code 1。
*   **嚴厲審查與潛在漏洞 (Shortcomings & Loop-holes)**:
    *   **邊緣技能測試盲區**: 現有的自動化測試高度集中在 `todo-cli.js` 狀態機與 `tier-router.js`。其餘核心技能如 `environment-detection` (`preflight.js`)、`hooks/scripts/boundary-guard.js`、`rule-of-3.js`、`create-agent-launcher` 等，在 CI 回歸套件中僅進行了「靜態語法編譯檢查（Phase 1）」，**完全沒有針對其執行邏輯與極限邊界的自動化行為斷言**。
    *   **沙箱環境模擬不足**: 測試套件無法在本地自動模擬 Claude Code 的 `PreToolUse` / `PostToolUse` 鉤子觸發。這導致諸如「 boundary-guard 攔截 >600KB 讀取」或「 rule-of-3 阻斷 mutating 寫入」等物理防禦，必須透過手動往 stdin 餵 JSON 的方式進行模擬，無法做到真正的持續整合自動化測試（CI Test Pipeline）。

---

### 指標四：配置平衡度（輕量 vs 重型）(Configuration Balance) —— **評分：9.0 / 10**
*   **優勢分析**:
    *   **高度適配的環境對齊**: 針對 Claude Code 提供了極致安全的「重型物理鉤子防禦」（`boundary-guard.js`, `rule-of-3.js`）；針對 Copilot、Cursor、Codex 則提供了高度壓縮的「輕量化 advisory 提示檔」（`.cursorrules`, `.github/copilot-instructions.md`, `AGENTS.md`）。
    *   **自癒機制機制 (Self-Heal)**: 提供 `self-heal.js`，能夠自動檢測並修復因不同編輯器切換而遺失的整合觸點，極大程度減少了多平台切換時的規則漂移。
*   **嚴厲審查與潛在漏洞 (Shortcomings & Loop-holes)**:
    *   **重型配置下的「摩擦力」**: 物理鉤子（如阻斷 >600KB 讀取）在確保 Token 效率的同時，也可能在調試大型 log 或資料庫 dump 時造成物理阻礙。Agent 被迫要改寫工具行為，這在極少數極端調試場景下會降低開發流暢度。
    *   **輕量配置下的「規則漂移與無聲降級」**: 在 Copilot 或 Cursor 中，由於缺乏 Hook 機制，當 context 超過 30k tokens 時，Agent 極易在「注意缺陷」狀態下選擇忽視 `.cursorrules`。此時 TDD 契約將名存實亡，且系統無法阻止 Agent 進行盲目試錯。

---

### 指標五：工作流一致性 (Workflow Conformance) —— **評分：9.0 / 10**
*   **優勢分析**:
    *   **文檔與執行合一**: `docs/workflows/` 下針對各核心場景繪製了詳細的生命週期與觸發鏈路（如 TDD 必須載入環境偵測、查證與驗證循環）。
    *   **狀態機硬性卡點**: 透過 `todo-cli.js` 強制了「一次只能 in-progress 一個任務」與「必須通過驗證關卡才能 complete」的實體工作流，防止 Agent 執行 Compliance Theater（指口頭宣稱做完但實際上根本沒寫測試或沒通過編譯）。
*   **嚴厲審查與潛在漏洞 (Shortcomings & Loop-holes)**:
    *   **技能內部過渡的不可稽核性**: 雖然 `todo-cli.js` 限制了任務的巨觀狀態，但它無法在細粒度上稽核技能內部的工作流。例如：在 TDD 模式下，Agent 是否「真的先寫了測試（Red），執行失敗，才去寫代碼（Green）」，抑或是在同一次代碼編輯中同時把測試和代碼寫好？目前的系統缺乏對文件修改時間差（Modify Timestamp）或 Git commit 歷史的時間線追溯，依舊存在「假裝走完 TDD 流程」的漏洞。

---

## 📊 2. 平台功能支援矩陣 (Platform Feature Matrix)

根據實測與架構剖析，Harness OS 在各主流 AI IDE 中的底層能力支援如下：

| 功能特性 (Feature) | Claude Code | Codex CLI | Cursor | GitHub Copilot |
| :--- | :---: | :---: | :---: | :---: |
| **自動化 Hook 攔截** | 🟢 完整 (Pre/Post) | 🔴 無 | 🔴 無 | 🔴 無 |
| **物理斷路器阻斷** | 🟢 實體卡點 (Exit 2) | 🔴 無 | 🔴 無 | 🔴 無 |
| **運行時狀態控制 (WAL)**| 🟢 實體寫入與比對 | 🟡 部分 (手動 CLI) | 🟡 部分 (手動 CLI) | 🟡 部分 (手動 CLI) |
| **環境自癒 (Self-Heal)** | 🟢 自動觸發 | 🟡 手動執行 | 🟡 手動執行 | 🟡 手動執行 |
| **認知提示引導 (Advisory)**| 🟢 完整配置 | 🟢 `AGENTS.md` | 🟢 `.cursorrules`| 🟢 `copilot-instructions` |
| **行為測試機 (Behavior Test)**| 🟢 自動執行 | 🟢 可手動執行 | 🟢 可手動執行 | 🟢 可手動執行 |

*註：`🟢` 代表完全支援且自動化執行；`🟡` 代表需依賴 Agent 認知主動執行或透過手動指令配合；`🔴` 代表受限於平台 API，無法實現該功能。*

---

## 🏆 3. 整體評分表 (Overall Scorecard)

| 評估維度 (Category) | 得分 (Score) | 深度分析與未來改進方向 |
| :--- | :---: | :--- |
| **系統架構 (Architecture)** | **9.2 / 10** | **極致的解耦與防錯設計**。將狀態持久化與 CLI 工具分離，利用 Hook 和狀態機檔案維持 Agent 執行一致性，極富工程嚴謹度。 |
| **文檔完整度 (README Completeness)**| **9.5 / 10** | **無可挑剔的說明書**。`VERIFICATION.md` 與 `BENCHMARK_SOP.md` 提供極其精確的命令、預期結果與測試案例，防範任何口頭忽悠。 |
| **系統可維護性 (Maintainability)**| **9.0 / 10** | **易於擴展與清理**。提供 `self-regression.js` 作為自我回歸保障，使後續開發新 Skill 時能確保基礎不被動搖，重設腳本健全。 |
| **技能設計與契約 (Skills Design)** | **9.2 / 10** | **契約式編程（DbC）的典範**。Skill Contract 將輸入輸出、副作用與硬閘口定義得極其清楚，使 Agent 行為極具預測性。 |
| **多代理與相容性 (Compatibility)** | **8.2 / 10** | **受限於 IDE API 的非對稱性**。在 Claude 外的平台缺乏實體閘口，只能退化至「引導提示」，這並非系統設計問題，而是平台生態天花板限制。 |
| **新手/開發者友善度 (Friendliness)**| **8.8 / 10** | **操作指引清晰**。自癒腳本（`self-heal.js`）與路由器的推薦導引，能幫助開發者或 Agent 在第一時間知道該查閱哪些規範。 |
| **總分 (Weighted Average)** | ⭐⭐⭐⭐⭐ **9.0 / 10** | **具備高度工業級水準的 AI Agent 協調作業系統。** |

---

## 🛠️ 4. 架構優化與改進建議 (Actionable Recommendations)

為使 Harness 系統更臻完美，以「最嚴厲的角度」提出以下 4 點具體改良方案：

1.  **升級路由器為「雙階段混合路由（Two-Stage Hybrid Router）」**：
    *   *現狀*: 單純的扁平關鍵字匹配易對「包含 architecture 字眼的純問答」產生誤判。
    *   *方案*: 引入「先分類意圖，後匹配關鍵字」的兩階段機制。第一階段先區分 Prompt 是 **[Action]** (有代碼寫入意圖) 還是 **[Q&A/Audit]** (純分析意圖)。若為純分析，即使包含 `refactor` 也應限制在 Tier 1 或 Tier 2 的 `grill-me` 模式，避免濫用 Tier 3 流程。
2.  **擴充 `eval-framework` 對核心邊界腳本的「單元整合測試」**：
    *   *現狀*: Behavior Test 僅覆蓋了 `todo-cli.js` 的狀態轉移。
    *   *方案*: 增設 `eval-framework/cases-unit.js`，模擬當傳入 >600KB 檔案時 `boundary-guard.js` 的反應；模擬當連續呼叫三次時 `rule-of-3-tracker.js` 寫入的歷程。唯有將邊界防禦腳本全面納入自動化測試，才能徹底防範未來 Skill 重構時的「隱性功能失效」。
3.  **研發「Git Timeline 稽核機制（TDD Compliance Auditor）」**：
    *   *現狀*: Agent 有可能在 TDD 任務中同時寫完測試與實作，然後虛假宣稱自己遵守了 Red-Green-Refactor。
    *   *方案*: 在 `todo-cli.js complete` 的驗證環節中，加入 Git Timeline 稽核。檢查當前暫存區或 commit 歷史，是否**確實存在一個僅修改測試檔且測試失敗的暫存版本（RED）**，再存在代碼實作並測試成功的版本（GREEN）。用時間線物證徹底杜絕 Agent 的「合規劇院（Compliance Theater）」。
4.  **提供 advisory 平台上的「主動式心跳檢測（Active Heartbeat Watcher）」**：
    *   *現狀*: 非 Claude 平台沒有 PreToolUse 鉤子，Agent 容易在大 Context 下迷失。
    *   *方案*: 當 Agent 在 Copilot / Cursor 中啟動時，引導其建立一個本地背景 watch 任務（或在 `[Discover]` 階段強制跑一次 `node harness-everything/scripts/verify-gate.js`），以偵測當前目錄下的實體修改，主動輸出 CLI 警告。這能將「靜態 advisory」轉化為「半動態的控制台提醒」，增強非 Claude 平台的控管力道。
