// 自動產生專案資料夾最上層的「AI說明.md」：給 AI（Claude、GPT 等）看的說明書
import { Card, CardSectionId, Schemas } from './model';
import { FILES_SECTION, getCardSections, sectionMeta } from './sections';

export const AI_GUIDE_NAME = 'AI說明.md';

const fieldOf = (card: Card, key: string) => card.fields.find((f) => f.key === key)?.value.trim() ?? '';

export function buildAiGuide(projectName: string, cards: Record<CardSectionId, Card[]>, schemas: Schemas): string {
  const out: string[] = [];
  const line = (s = '') => out.push(s);
  line(`# ${projectName}：給 AI 的說明`);
  line();
  line('> 這個檔案由 VN Script Editor 自動產生，每次指令或欄位設定有變就會重寫，請不要手動修改。');
  line('> 修改這個專案前請先讀完這份說明。編輯器開著時，你在外面改的檔案會即時顯示在編輯器裡。');
  line();
  line('## 資料夾結構');
  line();
  line('| 位置 | 內容 |');
  line('|---|---|');
  line('| `劇本/**/*.vns` | 劇本（純文字），子資料夾可以自由建立 |');
  for (const s of getCardSections()) line(`| \`${s.dir}/**/*.md\` | ${s.title}的設定卡，一張卡一個檔案 |`);
  line('| `圖片/` | 卡片的圖片欄位和詳細內容裡用到的圖（編輯器貼上或選圖時自動放進來） |');
  line('| `project.json` | 專案設定（欄位設定 `schemas`、左側清單順序 `order`），一般不需要改 |');
  line(`| \`${AI_GUIDE_NAME}\` | 這份說明（自動產生） |`);
  line();
  line('- 所有檔案都是 UTF-8。');
  line('- 以 `.` 開頭的資料夾（例如 `.git`）會被忽略。');
  line();
  line('## 劇本語法（.vns）');
  line();
  line('- 一般的一行就是對白或旁白，照原樣顯示。');
  line('- 行首是 `#` 的是**指令**：`#指令名稱 參數1 參數2 …`，參數用空白分開（指令前面可以有空白）。能用的指令列在下面「目前的指令」。');
  line('- `//` 到行尾是**註解**，不會輸出；指令後面也可以接註解，例如 `#fade in 3 // 慢一點`。');
  line('- `= 大標題`、`== 中標題`、`=== 小標題`（`=` 後面要有空格）：分段用的標題，編輯器右邊的大綱會列出來，**不會輸出**。前面加 `//` 是註解掉的標題，例如 `//= 草稿`。');
  line('- `{本文|讀音}`：**標音**，讀音會顯示在本文上方，例如 `{漢字|かんじ}`、`{秘儀|アルカナ}`。本文和讀音裡不能有 `{`、`}`、`|`。設定卡的詳細內容也用同一種寫法。');
  line('- 編輯器會檢查指令：沒有這種寫法、參數不在選項裡、類型不對、多填或少填參數，都會標成錯誤。');
  line();
  line('## 設定卡格式（.md）');
  line();
  line('開頭是 YAML（`---` 包起來），後面是 Markdown 的「詳細內容」：');
  line();
  line('```markdown');
  line('---');
  line('name: 小明');
  line('fields:');
  line('  - key: 年齡');
  line("    value: '17'");
  line('  - key: 個性');
  line('    value: |-');
  line('      開朗');
  line('      有點迷糊');
  line('    collapsed: true');
  line('---');
  line();
  line('# 大標題');
  line('這裡是詳細內容（Markdown：# ## ### 標題、條列、編號、粗體）。');
  line('```');
  line();
  line('- `name`：卡片名稱。**檔名要等於名稱**（`\\ / : * ? " < > |` 換成 `_`），例如名稱 `#fade` 的檔名是 `#fade.md`。');
  line('- `fields`：條列欄位，照順序排；`value` 多行時用 `|-`。`collapsed: true` = 側邊欄只顯示欄位名稱（可省略）。');
  line('- 同一個資料夾裡的卡片名稱不能重複。');
  line();
  const memorySections = getCardSections().filter((d) => d.memory);
  if (memorySections.length > 0) {
    line('## 記憶（' + memorySections.map((d) => d.title).join('、') + '）');
    line();
    line('這些區塊的卡片可以有 `memories`：這張卡（例如角色）記得的事。**清單順序就是時間順序**，新的記憶接在後面，插在中間要照劇情先後。');
    line();
    line('```yaml');
    line('memories:');
    line("  - time: '4/12'");
    line('    target: 小明');
    line('    kind: 事件');
    line('    text: 在咖啡廳第一次見面');
    line('    source: 第一章/序章.vns');
    line("  - time: '4/12'");
    line('    target: 小明');
    line('    kind: 稱呼');
    line('    text: 「那個店員」');
    line('    source: 第一章/序章.vns');
    line('```');
    line();
    line('- `kind`：`事件`（發生過的事）、`稱呼`（從這時候起怎麼叫對方）、`印象`（從這時候起對對方的看法）。稱呼和印象改變時新增一筆，不要改舊的。');
    line('- `target`：對象的卡片名稱（可省略）。`time`：故事裡的日期，格式隨意（可省略）。');
    line(`- \`source\`：出處，劇本相對於 \`${FILES_SECTION.dir}/\` 的路徑（可省略）。`);
    line('- 記憶是單向的：A 卡上記的是 A 的記憶，B 怎麼看 A 要記在 B 卡上。');
    line();
  }
  line('## 各區塊的固定欄位');
  line();
  line('每張卡都一定要有這些欄位（順序照這裡）。標了「指令參數」的，它的內容（或卡片名稱）可以填進指令的 `[參數]`。');
  line('標了「圖片」的欄位，`value` 是圖檔相對於專案資料夾的路徑（例如 `圖片/立繪.png`），沒有圖就留空。不在下面清單裡的欄位，如果有 `type: image`，也是圖片欄位。');
  line('詳細內容裡的圖片寫成 `![](圖片/x.png)`，調過寬度的寫成 `<img src="圖片/x.png" width="400">`。');
  line();
  for (const s of getCardSections().map((d) => d.id)) {
    const schema = schemas[s] ?? { fields: [] };
    const items = [
      ...(schema.nameParam ? [`名稱（指令參數 \`[${schema.nameParam}]\`）`] : []),
      ...schema.fields.map((f) => {
        const notes = [f.type === 'image' ? '圖片' : '', f.param ? `指令參數 \`[${f.param}]\`` : ''].filter(Boolean);
        return notes.length > 0 ? `${f.key}（${notes.join('，')}）` : f.key;
      }),
    ];
    line(`- **${sectionMeta(s).title}**：${items.length > 0 ? items.join('、') : '（沒有規定）'}`);
  }
  line();
  line('## 指令卡的寫法');
  line();
  line('- 卡片名稱就是指令格式，例如 `#name [名字]`；同一個指令有好幾種寫法時，名稱寫 `#fade`，在「用法」欄位一行寫一種：');
  line('  ```');
  line('  #fade in：淡入 [time:int?：漸變時間]');
  line('  #fade out：淡出 [time:int?：漸變時間]');
  line('  #fade default [color] [time:int=0] ：淡到指定顏色');
  line('  ```');
  line('- 說明的寫法：字後面緊接冒號（`in：淡入`）是那個字的說明；`[ ]` 裡冒號後面（`[time:int?：漸變時間]`）是參數說明；冒號前面有空格（` ：淡到指定顏色`）是整行用法的說明。補齊清單和行尾提示會顯示這些說明。');
  line('- 參數寫法：`[名字]` 從清單選；`[time:int]` 整數、`[x:float]` 小數、`[t:text]` 文字；`[time:int=0]`、`[note?]` 可以不填；`in/out` 或 `in|out` 只能選其中一個；其他字照抄。');
  line('- `[參數]` 可以選的值：指令卡上同名的欄位（一行一個選項，`in：淡入` 冒號後面是說明），沒有的話用上面「固定欄位」裡設成那個指令參數的內容。');
  line('- 「說明」欄位：這個指令是做什麼的。');
  line();
  line('## 目前的指令');
  line();
  if (cards.commands.length === 0) {
    line('（還沒有指令）');
    line();
  }
  for (const card of cards.commands) {
    const usages = fieldOf(card, '用法').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const lines = usages.length === 0 || /\s/.test(card.name.trim()) ? [card.name.trim(), ...usages] : usages;
    line(`### ${card.name.trim() || '（未命名）'}`);
    const desc = fieldOf(card, '說明');
    if (desc) line(desc);
    line();
    for (const u of lines) line(`- \`${u}\``);
    for (const f of card.fields) {
      if (f.key === '用法' || f.key === '說明' || !f.value.trim()) continue;
      if (!lines.some((u) => u.includes(`[${f.key}`))) continue;
      const options = f.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      line(`- \`[${f.key}]\` 可以填：${options.map((o) => `\`${o}\``).join('、')}`);
    }
    line();
  }

  line('## 修改時要注意');
  line();
  line('- 只改需要改的地方，不要重新排版整個檔案。');
  line('- 新增設定卡時，放在對應區塊的資料夾，並照上面的 YAML 格式寫；檔名要等於卡片名稱。');
  line('- 劇本裡用的指令要符合「目前的指令」的寫法；需要新的指令時，先在 `指令/` 新增一張指令卡。');
  line(`- 不要修改 \`${AI_GUIDE_NAME}\`（會被自動蓋掉）。`);
  line();
  return out.join('\n');
}
