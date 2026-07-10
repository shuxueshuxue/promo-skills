// 终片段清单(cutlist)——FinalCut 总装机器的唯一素材源真相。
// 换源终渲 = 只改这个文件(见同目录 SWAP-GUIDE.md):acts 交付后把 video 段的
// src/eventsFile 指向 acts/actN.*,按新 events 更新 keepMs 剪点与 vos 起点即可。
// 改完必跑 scripts/final-cut-qa.mjs(法典 20:blackdetect 零命中 + VO 逐句对齐核对)。
//
// 素材现状:act1a/act3 = acts 大拍摄真源(3200×2000 2x);其余 video 段 = fragments
// 2x 清晰版重拍 take(2026-07-09,ShotLoopRecorder 2x/q100/fps20,与 acts 同规格)——
// 全片清晰度一致,无 1x 模糊段。keepMs 窗口按「画面有内容 + VO 起点=当句主语」圈定。
//
// 本文件必须保持「可擦除 TS」(纯类型+数据+函数,无 enum/装饰器):
// scripts/final-cut-qa.mjs 会用 node --experimental-strip-types 直接 import 它。

export const FPS = 30;
export const FADE_FRAMES = 12; // 叠化时长(Devin 语言:叠化为主)

// 全片提速(导演终版指令②):video 段 playbackRate=1.25,keepMs/事件锚点保持【源时间】,
// 输出时长与事件/镜头映射统一除以 RATE;vos.atMs 是【段输出轴】时刻 = 源步骤点剪后时间/RATE。
// VO 音频不变速不变调;合成段不吃 RATE(用精剪压缩等效:c1 294→265、c2 270→264、CTA 180→156)。
export const RATE = 1.25;

export const msf = (ms: number): number => Math.round((ms / 1000) * FPS);

// —— VO v2 十二句 + 因果桥 02b(male-qn-jingying,vo/lines.json 定稿;durMs = ffprobe 实测) ——
export type VoId =
  | "01" | "02" | "02b" | "03" | "04" | "05" | "06"
  | "07" | "08" | "09" | "10" | "11" | "12";

export const VO_TABLE: Record<VoId, { text: string; durMs: number; src: string }> = {
  "01": { text: "一个团队，知识却不共享。同一个问题问了四遍，资料散在五个地方。没有一个 Agent，了解你们想法的全部脉络。", durMs: 8382, src: "vo/01.mp3" },
  "02": { text: "这个 idea，是他和 agent 一起推演得到的。", durMs: 2450, src: "vo/02.mp3" },
  "02b": { text: "但它只在他自己的电脑里，别人用不上。", durMs: 2566, src: "vo/02b.mp3" },
  "03": { text: "咕咕让你的 Agent 一键上云。专属沙盒、专属模型，还带着你们讨论过的一切。", durMs: 4911, src: "vo/03.mp3" },
  "04": { text: "再给它装上你领域的本事。", durMs: 1625, src: "vo/04.mp3" },
  "05": { text: "教授把 agent 分享给学生，不是发一份文档，而是整段的思考。", durMs: 4516, src: "vo/05.mp3" },
  "06": { text: "新的合作者来了，添加好友。", durMs: 2450, src: "vo/06.mp3" },
  "07": { text: "再从工作台请一支现成的实验小队。人到齐，agent 也到齐。", durMs: 4156, src: "vo/07.mp3" },
  "08": { text: "人是洞见的注入者，不再是任务的推动者。", durMs: 2635, src: "vo/08.mp3" },
  "09": { text: "方案在你来我往里定稿。然后 Agent 们连夜开跑。", durMs: 2926, src: "vo/09.mp3" },
  "10": { text: "每一步产出，就记录在右手边。", durMs: 2194, src: "vo/10.mp3" },
  "11": { text: "他们的成果，不是孤例。每个学科，都可以用咕咕。", durMs: 3866, src: "vo/11.mp3" },
  "12": { text: "把方向交给你，把执行交给咕咕。", durMs: 2856, src: "vo/12.mp3" },
};

// —— BGM(导演已选 its-love;从曲目 15s 起铺,-18dB 垫底,VO 时 duck,CTA 段渐出) ——
export const BGM = {
  src: "music/its-love--corporate-暖调轻快.mp3",
  skipSeconds: 15, // 从曲目 15s 起播(导演决议)
  baseVolume: 0.13, // ≈ -18dB 垫底
  duckRatio: 0.35, // VO 出现时压到垫底的 35%(≈再 -9dB),不与旁白打架
  duckRampFrames: 9,
};

export type VoCue = { vo: VoId; atMs: number }; // atMs = 段输出时间轴上的起点
export type TransitionKind = "fade" | "cut";

export type SynthSegSpec = {
  kind: "synth";
  id: string;
  comp: "c1-pain" | "c2-local-idea" | "cta-card"; // FinalCut 内注册的成品合成组件
  durationFrames: number; // 精剪后时长(组件本地帧)
  trimStartFrames?: number; // 精剪:跳过组件开头 N 帧
  duckFrames?: [number, number][]; // 组件内嵌旁白的相对帧窗(BGM duck 用)
  embeddedVos?: { vo: VoId; atFrames: number }[]; // 内嵌旁白的 QA 登记(对齐核对抽帧用)
  vos?: VoCue[]; // 外铺 VO(音频 + 玻璃字幕条)
  transitionAfter?: TransitionKind; // 缺省 fade;最后一段忽略
};

// 装配级恒定取景:整段固定位姿(素材 CSS 坐标中心 + 恒定推近倍率),忽略事件运镜。
// 用于素材构图偏侧的窗口(如广场 feed 右半全空)——把空白推出画框;
// 位姿走 camera.ts 的 pinnedPose(与事件运镜同一套 pan-clamp,保证不露舞台底)。
export type FrameSpec = { cx: number; cy: number; z: number };

export type VideoSegSpec = {
  kind: "video";
  id: string;
  src: string; // renderer/public 相对路径
  keepMs: { fromMs: number; toMs: number }[]; // 原始素材时间轴上的保留段(升序不重叠)
  // 相机 events 来源(二选一,缺失即 throw):
  manifestId?: string; // 占位期:从 manifest.ts 的 fragment 借 viewport+events
  eventsFile?: string; // acts 交付后:public 相对路径 events.json({viewport, events})
  frame?: FrameSpec; // 恒定取景(给了就整段固定,不走事件运镜)
  vos?: VoCue[];
  transitionAfter?: TransitionKind;
};

export type SegSpec = SynthSegSpec | VideoSegSpec;

// ————————————————————————————————————————————————————————————————
// 时间轴(final-cut-plan §三;video 段 = 占位,acts 交付后换源)
// 总长 = layoutCutlist().totalFrames(目标 115–125s)
// ————————————————————————————————————————————————————————————————
export const CUTLIST: SegSpec[] = [
  // 序幕 · 用前之痛(c1 v3 成品组件直嵌,精剪至 b1+b2 两拍≈9.8s;内嵌旁白/字幕)
  {
    kind: "synth",
    id: "prologue-c1",
    comp: "c1-pain",
    durationFrames: 265, // 单轨 VO01 字幕 [8,265] 收干净即掐(精剪压缩,等效提速)
    duckFrames: [[0, 263]],
    embeddedVos: [{ vo: "01", atFrames: 8 }],
    transitionAfter: "cut", // 导演定稿:c1→c2 硬切
  },
  // 幕一A · 本地 codex 终端磨 idea(c2 成品组件,内嵌 VO2)
  // 段尾静置拍(推近关键结论)承载因果桥 VO 2b:「但它只在他自己的电脑里」→ 引出上云
  {
    kind: "synth",
    id: "act1-local-c2",
    comp: "c2-local-idea",
    durationFrames: 264, // VO2b 字幕帧 263 收干净即掐(精剪压缩)
    duckFrames: [[30, 142]],
    embeddedVos: [{ vo: "02", atFrames: 30 }],
    vos: [{ vo: "02b", atMs: 6000 }], // 帧 180-257,叠化(258 起)前收干净
  },
  // 幕一B · 创建向导(占位:m1-agent-birth;终源 acts/act1a)
  {
    kind: "video",
    id: "act1a-wizard",
    src: "acts/act1a.mp4",
    eventsFile: "acts/act1a.events.json",
    // 法典12+导演令:provision 死区(raw 20.4 provision-done → 57.5 ready 共 37s)剪掉,
    // 只留 ~2s 等待感(w1 尾 creating 1.6s + w2 头 0.3s)→ ready → agent 主动招呼
    keepMs: [
      { fromMs: 8300, toMs: 16000 }, // type-pick(9.1)→记忆继承(11.6,zoom★)→create(14.0)→modal 收(16.0)
      // 16.0–16.2 起模态关闭后是整面白 loading 页(QA 白屏实锤 1.8s)→ 掐掉,直接接 hello
      { fromMs: 57200, toMs: 61000 }, // hello 气泡已上屏(源 57.6 可见)→ 招呼语可读到尾帧
    ],
    vos: [{ vo: "03", atMs: 3840 }], // 起点 = 向导终步(创建键);1.25× 后 create 点击 ≈ 4.56s
  },
  // 幕一C · 技能安装(占位:m1c-skill-install;终源 acts/act1b)
  {
    kind: "video",
    id: "act1b-skills",
    src: "frag/m1c-skill-install/take.mp4",
    manifestId: "m1c-skill-install",
    keepMs: [{ fromMs: 16062, toMs: 25139 }], // 货架→install-1→install-2(2x 重拍 take,剪点按新 events 重锚)
    vos: [{ vo: "04", atMs: 2652 }], // 起点 ≈ install-1 点安装(2x take 19797,1.25× 后 → 2.99s)
  },
  // 幕二 · 分享动作(占位:m2 机位A;终源 acts/act2)
  {
    kind: "video",
    id: "act2a-share",
    src: "frag/m2-agent-share/take.mp4",
    manifestId: "m2-agent-share--A",
    keepMs: [{ fromMs: 25391, toMs: 32391 }], // agent 资料页→点分享→邀请(1.25× 后 VO05 需 5.2s 窗,尾部多留 1s 源料)
    vos: [{ vo: "05", atMs: 710 }], // 名片在屏即起(1.25× 后分享点击 ≈ 3.0s,VO 收在段内)
  },
  // 幕二 · 林晓视角(重制 take-b;无 VO 短拍)
  // 「通讯录亮起」全景是 99%+ 白的稀疏页(白屏 QA 过不去)→ 改圈「整段讨论脉络上屏」拍
  // (= 重制前成片 m2B 同款窗口:群聊里 agent 带着全部推演应答,镜头推近关键回复)
  {
    kind: "video",
    id: "act2b-receive",
    src: "frag/m2-agent-share/take-b.mp4",
    manifestId: "m2-agent-share--B",
    keepMs: [
      { fromMs: 54744, toMs: 58344 }, // 群聊:问一句 → agent 应答整段脉络(context 57974 zoom)
    ],
  },
  // 幕三A · 加陈屿:搜 ID→发申请(真源 acts/act3)
  {
    kind: "video",
    id: "act3-add",
    src: "acts/act3.mp4",
    eventsFile: "acts/act3.events.json",
    // 法典12:8.2→14.2 打字段掐中间;8.2 后的搜索结果页是 99%+ 白稀疏页(白屏 QA)→ w1 收在 8.2 前
    keepMs: [
      { fromMs: 2400, toMs: 8200 }, // 添加入口(3.9)→输入 ID(搜索结果上屏前收)
      { fromMs: 13400, toMs: 15986 }, // 申请弹窗→发送申请(14.2)
    ],
    vos: [{ vo: "06", atMs: 2080 }], // 起点画面 = 添加联系人搜索框输入 ID 中(1.25× 重锚)
  },
  // 幕三A' · 陈屿接受镜(acts/act3x)已下架:整段是单行请求页(99%+ 白,白屏 QA 三处命中之一,
  // 源里无更密画面可圈),且重制基准成片本就无此镜——加人闭环由 act3-add 的「发送申请」示意。
  // 若要恢复,需 B 线/协调者补拍更满的接受画面。
  // 幕三B · 工作台导入小队 + 列队报到(占位:h1-team-import;真源待补)
  // w2 按内容重圈(原 [54900,63500] 大半是空白页,导演打回的 1:02 空白屏):
  // 报到消息实际从 raw ~61s 起逐条上屏
  {
    kind: "video",
    id: "act3-team",
    src: "frag/h1-team-import/take.mp4",
    manifestId: "h1-team-import",
    keepMs: [
      { fromMs: 10618, toMs: 18506 }, // 工作台货架→选队→导入向导
      { fromMs: 57619, toMs: 62619 }, // 群建成,报到消息逐条上屏(重制阵容=幕四同款小队,4 员报到)
    ],
    vos: [{ vo: "07", atMs: 2894 }], // 起点 ≈ 点「导入」(1.25× 后 → 2.72s),句尾跨剪点落在报到戏
  },
  // 幕四 · 群协作高潮(占位:m4-collab;终源 acts/act4)
  {
    kind: "video",
    id: "act4-collab",
    src: "frag/m4-collab/take.mp4",
    manifestId: "m4-collab",
    keepMs: [
      { fromMs: 15203, toMs: 32547 }, // 人提需求→agent 逐个认领
      { fromMs: 42171, toMs: 51445 }, // 定稿→开跑运行条
      { fromMs: 60276, toMs: 65479 }, // 侧栏拉开,沉淀逐项(开跑→侧栏间隔的拖沓段剪掉——法典 12)
    ],
    vos: [
      { vo: "08", atMs: 1680 }, // 起点 ≈ humans-talk(2x take 17396,1.25× → 1.75s)
      { vo: "09", atMs: 14995 }, // 起点 ≈ plan-v2 上屏(2x take 43651,1.25× → 15.1s)
      { vo: "10", atMs: 22369 }, // 起点 ≈ 侧栏拉开(2x take 61676,1.25× → 22.4s)
    ],
  },
  // 幕五A · 群里庆祝(占位:m5-plaza;终源 acts/act5)——群聊满幅画面,事件运镜保持原样
  {
    kind: "video",
    id: "act5-celebrate",
    src: "frag/m5-plaza/take.mp4",
    manifestId: "m5-plaza",
    keepMs: [{ fromMs: 8400, toMs: 14900 }], // 群里庆祝(2x take 群历史 8.3s 才满帧渲染完 → 起点后移防白屏)
    transitionAfter: "cut", // 原为同段内 keepMs 硬切;拆段后保持硬切 → 总长/VO 绝对时刻不变
  },
  // 幕五B · 好友动态流(终审 fix2:装配级恒定取景)——feed 双列内容只占源 x≈90–1030,
  // x>1030 全空;恒定推近把右半空白推出画框(z=1.85 时可视窗 x∈[0,1144],左右留白≈对称,
  // pan-clamp 钳左缘不露舞台底)。庆祝段满幅,故拆两段、取景只挂 feed 段。
  {
    kind: "video",
    id: "act5-feed",
    src: "frag/m5-plaza/take.mp4",
    manifestId: "m5-plaza",
    keepMs: [{ fromMs: 21327, toMs: 29827 }], // 好友动态流
    frame: { cx: 560, cy: 500, z: 1.85 }, // 双列中心 cx≈560,垂直居中
    vos: [{ vo: "11", atMs: 320 }], // 起点 ≈ 动态 feed 上屏(原合段 atMs 5520 − 庆祝段 5200)
  },
  // 幕五 · 手机插镜「装进口袋」(f3-v2 交付后换 take;短插镜,无 VO,BGM 垫)
  {
    kind: "video",
    id: "act5-mobile",
    src: "frag/f3-mobile-shell/take.mp4",
    manifestId: "f3-mobile-shell",
    keepMs: [{ fromMs: 14675, toMs: 18875 }], // 转发菜单
  },
  // CTA · 合成收尾卡(内嵌 VO12;禁 zoom,静置渐显)
  {
    kind: "synth",
    id: "cta",
    comp: "cta-card",
    durationFrames: 156, // VO12 帧 98 收干净 + 静置渐出(精剪压缩)
    duckFrames: [[12, 104]],
    embeddedVos: [{ vo: "12", atFrames: 12 }],
  },
];

// ————————————————————————————————————————————————————————————————
// 静态布局:时长全部由 cutlist 显式声明 → 总长/段起点/VO 绝对时刻编译期可算。
// FinalCut.tsx(渲染)与 scripts/final-cut-qa.mjs(QA)共用这一份真相。
// ————————————————————————————————————————————————————————————————

export const segFrames = (seg: SegSpec): number =>
  seg.kind === "synth"
    ? seg.durationFrames
    : seg.keepMs.reduce((a, k) => a + Math.max(1, msf((k.toMs - k.fromMs) / RATE)), 0);

export const transAfter = (seg: SegSpec): TransitionKind => seg.transitionAfter ?? "fade";

export type LayoutCue = {
  vo: VoId;
  segId: string;
  text: string;
  startFrame: number; // 全片绝对帧
  durFrames: number;
  embedded: boolean; // true = 合成组件内嵌旁白(音频不由 FinalCut 铺)
};

export type Layout = {
  starts: number[]; // 各段绝对起始帧(与 CUTLIST 同序)
  totalFrames: number;
  cues: LayoutCue[]; // 全片 VO 时刻表(含内嵌),QA 对齐核对的依据
  duckWindows: [number, number][]; // BGM duck 的绝对帧窗
  ctaStartFrame: number;
};

export function layoutCutlist(): Layout {
  const starts: number[] = [];
  let f = 0;
  CUTLIST.forEach((seg, i) => {
    starts.push(f);
    f += segFrames(seg);
    if (i < CUTLIST.length - 1 && transAfter(seg) === "fade") f -= FADE_FRAMES;
  });

  const cues: LayoutCue[] = [];
  const duckWindows: [number, number][] = [];
  CUTLIST.forEach((seg, i) => {
    const start = starts[i];
    for (const c of seg.vos ?? []) {
      const from = start + msf(c.atMs);
      const dur = msf(VO_TABLE[c.vo].durMs);
      cues.push({ vo: c.vo, segId: seg.id, text: VO_TABLE[c.vo].text, startFrame: from, durFrames: dur, embedded: false });
      duckWindows.push([from, from + dur]);
    }
    if (seg.kind === "synth") {
      const trim = seg.trimStartFrames ?? 0;
      for (const e of seg.embeddedVos ?? []) {
        const from = start + Math.max(0, e.atFrames - trim);
        cues.push({
          vo: e.vo,
          segId: seg.id,
          text: VO_TABLE[e.vo].text,
          startFrame: from,
          durFrames: Math.min(msf(VO_TABLE[e.vo].durMs), seg.durationFrames),
          embedded: true,
        });
      }
      for (const [a, b] of seg.duckFrames ?? []) {
        const from = Math.max(0, a - trim);
        const to = Math.min(seg.durationFrames, b - trim);
        if (to > from) duckWindows.push([start + from, start + to]);
      }
    }
  });
  cues.sort((a, b) => a.startFrame - b.startFrame);

  return {
    starts,
    totalFrames: f,
    cues,
    duckWindows,
    ctaStartFrame: starts[CUTLIST.length - 1],
  };
}
