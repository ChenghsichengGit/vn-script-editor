export interface Heading {
  level: number;
  text: string;
  pos: number; // 在文件裡的位置，用來跳過去
}

export default function Outline(props: { headings: Heading[]; active: number; onJump: (i: number) => void }) {
  return (
    <nav className="outline">
      {props.headings.length === 0 ? (
        <div className="outline-empty">加入標題後，目錄會顯示在這裡</div>
      ) : (
        props.headings.map((h, i) => (
          <div
            key={i}
            className={`outline-item${i === props.active ? ' active' : ''}`}
            style={{ paddingLeft: 10 + (h.level - 1) * 14 }}
            onClick={() => props.onJump(i)}
          >
            {h.text || '（空白標題）'}
          </div>
        ))
      )}
    </nav>
  );
}
