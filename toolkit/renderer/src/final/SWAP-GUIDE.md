# final-cut 换源终渲指南（acts 交付后）

FinalCut 是段清单驱动的总装机器：**素材源只在 `src/final/cutlist.ts` 里声明**。
当前所有 video 段是 fragments 占位素材（仅验证装配机械），acts 交付后按下面三步换源。

## 三步换源

1. **落素材**：把大拍摄交付物放进 `renderer/public/acts/`：
   `act1a.mp4 … act5.mp4` + 各自的 `actN.events.json`（格式 `{ video, viewport, events }`，
   events 带 `zoom: true` 白名单标记——相机代码只对白名单事件推近，其余全景）。

2. **改 cutlist**：对 `cutlist.ts` 里每个 video 段：
   - `src` → `"acts/actN.mp4"`；删掉 `manifestId`，改成 `eventsFile: "acts/actN.events.json"`；
   - `keepMs` → 按新 events 时间戳圈保留段（原始素材毫秒；升序不重叠，超出素材时长会直接
     报错停——fail loud，不静默兜底）；
   - `vos[].atMs` → 按段输出时间轴对准动作起点。**法典 20：每句 VO 的起点画面必须就是
     它的主语**（旁白不许晚到，也不许张冠李戴）。VO 音频时长已在 `VO_TABLE`。

3. **终渲 + QA**：
   ```bash
   cd renderer
   npx remotion render final-cut ../renders/final-cut.mp4
   node scripts/final-cut-qa.mjs        # 装配 QA(见下),不过不算装完
   ```

## 装配 QA 工序（法典 20；导演验收项，换源后必须重跑同一套）

`scripts/final-cut-qa.mjs` 对成片自动执行：

1. **空白屏扫描**：对每个 video 段，在**卡片内部区域**（按该段 viewport 算 Stage 几何、
   内缩 8%）跑 `blackdetect=d=0.4:pix_th=0.10`（黑）+ `negate,blackdetect`（白）。
   任何 ≥0.4s 的整面黑/白 = 剪点圈到了空画面，脚本退出码 1。修 `keepMs` 后重渲重跑，
   **零命中才算过**。（占位期教训：h1 raw 54.9–61s、m2B raw 37–40s 都是空白页——
   events 时间戳 ≠ 画面有内容，剪点必须对着真帧圈。）
2. **VO 对齐抽帧**：每句 VO（含 c1/c2/CTA 内嵌旁白）起点+中点各抽一帧到
   `renders/final-cut-qa/vo-<句>-{start,mid}.png`，并打印全片 VO 时刻表。
   **逐帧人工核对：起点帧的画面主语 = 当句旁白主语**，逐句记入回报表。

两项都过（扫描零命中 + 13 帧起点全对齐）才算装配完成，才可上评审台。

## 机械说明（不需要动的部分）

- **video 段渲染链路**：`ZoomFollow`（Stage 卡片舞台 + 缩放白名单相机 + keepMs 分段播放）
  整链路复用，events 会自动重映射到剪切后的输出时间轴、落在保留段外的事件自动丢弃。
- **字幕/VO**：终片字幕 = VO v2 十二句 + 因果桥 02b（`VO_TABLE`），按段 `vos` 铺
  （音频 + 玻璃字幕条一体）；`vos` 对合成段同样生效（02b 就铺在 c2 段尾的静置拍上）。
  fragment 旧字幕/旧配音一律不进终片；合成段（c1/c2/CTA）内嵌自己的旁白，在 cutlist 里
  用 `embeddedVos` 登记供 QA 抽帧。
- **BGM**：its-love 从曲目 15s 起铺、-18dB 垫底、VO 窗口自动 duck、CTA 段渐出、素材短于
  片长自动 loop。duck 窗口由 cutlist 的 `vos` + 合成段 `duckFrames` 推导，换源无需手调。
- **转场**：段间叠化 `FADE_FRAMES=12`；`transitionAfter: "cut"` = 硬切（序幕 c1→c2 已按导演
  定稿设为硬切）。
- **布局单一真相**：段起点/总长/VO 时刻表/duck 窗口全部由 `cutlist.ts` 的 `layoutCutlist()`
  编译期算出，FinalCut.tsx（渲染）与 QA 脚本共用；cutlist 必须保持可擦除 TS（QA 脚本用
  `node --experimental-strip-types` 直接 import 它）。改完 cutlist 核一眼总长 115–125s。
- 若 acts 素材换成暗色主题，空白扫描的「白」项自然失效、「黑」项 `pix_th` 可能要按
  暗色底的实际亮度微调——阈值改在 QA 脚本里，标准不变：整面无内容 = 打回。

## 校验（渲前自动跑）

`calculateMetadata` 会对每段：probe 素材真实时长、校验 keepMs 合法性、解析 events 文件——
任何一项不满足都抛错终止，错误信息带段 id。
