// 欄位的文字（側邊欄、放大檢視）：{本文|讀音} 畫成標音，[文字](網址) 和直接寫的網址畫成連結（點了用系統瀏覽器開）
import { Fragment } from 'react';

const TOKEN = /\{([^{}|\n]+)\|([^{}|\n]*)\}|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()[\]{}「」『』，。、！？]+)/g;

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="field-link"
      href={href}
      title={href}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation(); // 不要觸發所在那一列的展開／收合、放大
        void window.api.openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

export default function InlineText({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = m.index;
    if (m[1] !== undefined) {
      out.push(
        m[2].trim() ? (
          <ruby key={k}>
            {m[1]}
            <rt>{m[2]}</rt>
          </ruby>
        ) : (
          m[1]
        ),
      );
    } else if (m[3] !== undefined) {
      out.push(<Link key={k} href={m[4]}><InlineText text={m[3]} /></Link>);
    } else {
      out.push(<Link key={k} href={m[5]}>{m[5]}</Link>);
    }
    last = TOKEN.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out.map((n, i) => (typeof n === 'string' ? <Fragment key={`t${i}`}>{n}</Fragment> : n))}</>;
}
