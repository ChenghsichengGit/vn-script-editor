// 假資料：之後會改成從專案資料夾讀取，現在先寫死在這裡
import { Card, CardSectionId, SectionId } from './model';

// 四個區塊的標題、圖示，以及按＋時新卡片的預設名稱
export const sectionMeta: Record<SectionId, { title: string; icon: string; newName?: string }> = {
  files: { title: '檔案', icon: '📄' },
  characters: { title: '角色', icon: '👤', newName: '新角色' },
  world: { title: '世界觀', icon: '🌍', newName: '新項目' },
  commands: { title: '指令速查', icon: '⌘', newName: '新分類' },
};
export const sectionOrder: SectionId[] = ['files', 'characters', 'world', 'commands'];

// 劇本檔案的初始資料：id → 檔名和內容（執行時由 App 的 state 管理，可新增／改名／刪除）
export const scriptFiles: Record<string, { name: string; content: string }> = {
  ch1: {
    name: '第一章_開店.vns',
    content: `#bg : 咖啡廳_白天
#bgm : calm_01

#name : 店長
「歡迎光臨。今天也是個適合喝咖啡的日子呢。」

#name : 艾莉絲
「……這間店，昨天還不在這裡吧？」

#name : 店長
「是嗎？或許是妳昨天沒注意到而已。」

#choice
- 點一杯咖啡 -> scene_02
- 轉身離開 -> scene_bad
`,
  },
  ch2: {
    name: '第二章_常客.vns',
    content: `#bg : 咖啡廳_夜晚

#name : ？？？
「老樣子，一杯不加糖的。」
`,
  },
  memo: {
    name: '待辦.txt',
    content: `- 店長的過去要在第三章前埋伏筆
- 艾莉絲的口癖再想想
`,
  },
};

export const initialCards: Record<CardSectionId, Card[]> = {
  characters: [
    {
      id: 'owner',
      name: '店長',
      fields: [
        { key: '年齡', value: '不詳' },
        { key: '口癖', value: '「歡迎光臨。」' },
        { key: '代表色', value: '#c9a26b' },
        {
          key: '人際關係',
          value: '表面上跟誰都處得來，實際上沒有人真正了解他。唯一會跟他頂嘴的是隔壁巷子的黑貓。',
          collapsed: true,
        },
      ],
      detail: `# 背景

本名不明。在這間店開了不知道多少年，對舊神們的事情知道得比他說出口的還多。

# 個性

待人溫和，但從不回答關於自己的問題。

## 習慣

每到雨天會在吧台多擺一個空杯子。

# 人際關係

## 與艾莉絲

把她當成難得的「普通客人」，其實早就察覺她的體質。

## 與舊神

多數舊神都欠他人情，但他從不討。

# 伏筆

- 空杯子是為誰準備的
- 店長為什麼不會變老

### 第三章前要回收

- 空杯子的主人登場`,
    },
    {
      id: 'alice',
      name: '艾莉絲',
      fields: [
        { key: '年齡', value: '19' },
        { key: '個性', value: '好奇、嘴硬' },
      ],
      detail: `# 背景

大學生，因為躲雨誤闖咖啡廳。

# 能力

看得見常人看不見的客人，但自己還沒發現這件事。`,
    },
  ],
  world: [
    {
      id: 'cafe',
      name: '咖啡廳',
      fields: [
        { key: '位置', value: '只在雨天出現的巷口' },
        { key: '營業時間', value: '不固定' },
      ],
      detail: '只有「需要它的人」才找得到入口。店內的時間流動和外面不同。',
    },
    {
      id: 'oldgods',
      name: '舊神',
      fields: [{ key: '概要', value: '被遺忘後會變成客人' }],
      detail: '',
    },
  ],
  commands: [
    {
      id: 'stage',
      name: '演出',
      fields: [
        { key: '#name : 角色', value: '顯示說話者名字' },
        { key: '#bg : 背景', value: '切換背景圖' },
        { key: '#bgm : 曲名', value: '播放背景音樂' },
      ],
      detail: '',
    },
    {
      id: 'flow',
      name: '流程',
      fields: [
        { key: '#choice', value: '開始一組選項' },
        { key: '- 文字 -> 場景', value: '選項與跳轉目標' },
      ],
      detail: '',
    },
  ],
};
