// =============================================================================
// ChatGraph — src/markdown.js
// Converts Claude's markdown output to safe HTML for node cards.
// Supports: fenced code blocks (with syntax highlighting), tables,
//           blockquotes/callouts, headings, HR, bold/italic/inline-code, UL, OL.
// =============================================================================

// Token-based syntax highlighter. Returns HTML-escaped string with <span class="hl-*"> tags.
// Priority order: comments > strings > keywords > builtins > numbers.
function highlightCode(rawCode, lang) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!lang) return esc(rawCode);

  const L = lang.toLowerCase();
  const alias = { py: 'python', js: 'javascript', ts: 'typescript',
                  jsx: 'javascript', tsx: 'typescript', sh: 'bash', zsh: 'bash' };
  const resolved = alias[L] || L;

  let tokenDefs;
  if (resolved === 'python') {
    tokenDefs = [
      { cls: 'hl-comment', re: /#[^\n]*/g },
      { cls: 'hl-str',     re: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g },
      { cls: 'hl-kw',      re: /\b(def|class|import|from|as|if|elif|else|for|while|in|not|and|or|is|None|True|False|pass|break|continue|with|try|except|finally|raise|lambda|yield|global|del|assert|async|await|return)\b/g },
      { cls: 'hl-builtin', re: /\b(print|len|range|enumerate|zip|map|filter|list|dict|set|tuple|str|int|float|bool|type|isinstance|hasattr|getattr|setattr|super|open|input|sorted|reversed|any|all|sum|min|max)\b/g },
      { cls: 'hl-num',     re: /\b0x[\da-fA-F]+|\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g },
    ];
  } else if (resolved === 'javascript' || resolved === 'typescript') {
    tokenDefs = [
      { cls: 'hl-comment', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//g },
      { cls: 'hl-str',     re: /`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g },
      { cls: 'hl-kw',      re: /\b(const|let|var|function|return|if|else|for|while|of|in|class|import|export|default|new|this|typeof|instanceof|null|undefined|true|false|async|await|try|catch|finally|throw|switch|case|break|continue|from|type|interface|extends|implements|readonly|enum|as|is|void|never|any|unknown)\b/g },
      { cls: 'hl-builtin', re: /\b(console|Math|JSON|Object|Array|String|Number|Boolean|Promise|setTimeout|clearTimeout|fetch|document|window|Error|Map|Set|Symbol|Proxy|Reflect|parseInt|parseFloat|isNaN|isFinite)\b/g },
      { cls: 'hl-num',     re: /\b0x[\da-fA-F]+|\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g },
    ];
  } else if (resolved === 'bash') {
    tokenDefs = [
      { cls: 'hl-comment', re: /#[^\n]*/g },
      { cls: 'hl-str',     re: /"(?:[^"\\]|\\.)*"|'[^']*'/g },
      { cls: 'hl-kw',      re: /\b(if|then|else|elif|fi|for|while|do|done|function|return|export|local|in|case|esac|until|select)\b/g },
      { cls: 'hl-builtin', re: /\b(echo|cd|ls|mkdir|rm|cp|mv|grep|sed|awk|cat|chmod|source|set|unset|read|exit|pwd|touch|find|curl|wget|git|npm|node|python|python3)\b/g },
      { cls: 'hl-num',     re: /\b\d+\b/g },
    ];
  } else if (resolved === 'css') {
    tokenDefs = [
      { cls: 'hl-comment', re: /\/\*[\s\S]*?\*\//g },
      { cls: 'hl-str',     re: /"[^"]*"|'[^']*'/g },
      { cls: 'hl-num',     re: /-?\d+\.?\d*(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b/g },
      { cls: 'hl-kw',      re: /\b(auto|none|block|flex|grid|inline|absolute|relative|fixed|sticky|center|left|right|top|bottom|solid|dashed|dotted|normal|bold|italic|inherit|initial|unset)\b/g },
    ];
  } else {
    return esc(rawCode);
  }

  // Collect spans in priority order — earlier defs win on overlap
  const spans = [];
  tokenDefs.forEach(({ cls, re }) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(rawCode)) !== null) {
      const start = m.index, end = m.index + m[0].length;
      if (!spans.some(s => s.start < end && s.end > start)) {
        spans.push({ start, end, cls });
      }
    }
  });
  spans.sort((a, b) => a.start - b.start);

  let out = '', pos = 0;
  for (const sp of spans) {
    if (sp.start > pos) out += esc(rawCode.slice(pos, sp.start));
    out += `<span class="${sp.cls}">${esc(rawCode.slice(sp.start, sp.end))}</span>`;
    pos = sp.end;
  }
  if (pos < rawCode.length) out += esc(rawCode.slice(pos));
  return out;
}

function parseMarkdown(text) {
  if (!text) return '';

  const escape = (s) =>
    s.replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;');

  // Fenced code blocks — syntax-highlighted + language label
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const cls      = lang ? ` class="lang-${escape(lang)}"` : '';
    const langAttr = lang ? ` data-lang="${escape(lang)}"` : '';
    const label    = lang ? `<span class="code-lang-label">${escape(lang)}</span>` : '';
    const body     = highlightCode(code.trim(), lang);
    return `<pre data-code-block="1"${langAttr}>${label}<code${cls}>${body}</code></pre>`;
  });

  const parts = text.split(/(<pre[\s\S]*?<\/pre>)/g);

  const processInline = (chunk) => {
    chunk = escape(chunk);
    chunk = chunk.replace(/`([^`]+)`/g, '<code>$1</code>');
    chunk = chunk.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    chunk = chunk.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    chunk = chunk.replace(/\*(.+?)\*/g, '<em>$1</em>');
    chunk = chunk.replace(/_([^_]+)_/g, '<em>$1</em>');
    return chunk;
  };

  const isTableRow  = (line) => line.trim().startsWith('|') && line.trim().endsWith('|');
  const isSepRow    = (line) => /^\|[\s\-|:]+\|$/.test(line.trim());

  const processBlock = (chunk) => {
    const lines  = chunk.split('\n');
    const output = [];
    let inUl = false, inOl = false, pLines = [];
    let inBq = false, bqLines = [];
    let inTable = false, tableRows = [];

    const flushP   = () => { if (pLines.length)  { output.push(`<p>${pLines.join('<br>')}</p>`); pLines = []; } };
    const closeUl  = () => { if (inUl)  { output.push('</ul>');  inUl  = false; } };
    const closeOl  = () => { if (inOl)  { output.push('</ol>');  inOl  = false; } };

    const closeBq = () => {
      if (!inBq) return;
      inBq = false;
      const raw = bqLines.join(' ').trim();
      bqLines = [];
      const CALLOUT_TYPES = ['note', 'warning', 'important', 'tip', 'key', 'info', 'caution'];
      const lc = raw.toLowerCase();
      const matched = CALLOUT_TYPES.find(t => lc.startsWith(`**${t}**`) || lc.startsWith(`**${t}:**`));
      if (matched) {
        const icons = { note: 'ℹ', warning: '⚠', important: '★', tip: '💡', key: '🔑', info: 'ℹ', caution: '⚠' };
        const body  = raw.replace(/^\*\*\w+\b[:\s*]*\*\*:?\s*/i, '');
        output.push(
          `<div class="chatgraph-callout callout-${matched}">` +
          `<span class="callout-icon">${icons[matched]}</span>` +
          `<div class="callout-body">${processInline(body)}</div></div>`
        );
      } else {
        output.push(`<blockquote>${processInline(raw)}</blockquote>`);
      }
    };

    const flushTable = () => {
      if (!inTable) return;
      inTable = false;
      const rows = tableRows.filter(r => !isSepRow(r));
      tableRows = [];
      if (rows.length === 0) return;
      const parseCells = (row) => row.trim().slice(1, -1).split('|').map(c => c.trim());
      const headers = parseCells(rows[0]);
      let html = '<table class="chatgraph-table"><thead><tr>';
      headers.forEach(h => { html += `<th>${processInline(h)}</th>`; });
      html += '</tr></thead>';
      if (rows.length > 1) {
        html += '<tbody>';
        rows.slice(1).forEach(row => {
          html += '<tr>';
          parseCells(row).forEach(c => { html += `<td>${processInline(c)}</td>`; });
          html += '</tr>';
        });
        html += '</tbody>';
      }
      html += '</table>';
      output.push(html);
    };

    lines.forEach(line => {
      // ── Table
      if (isTableRow(line)) {
        flushP(); closeUl(); closeOl(); closeBq();
        inTable = true; tableRows.push(line); return;
      } else if (inTable) { flushTable(); }

      // ── Heading
      const hMatch = line.match(/^(#{1,3})\s+(.*)/);
      if (hMatch) {
        flushP(); closeUl(); closeOl(); closeBq();
        output.push(`<h${hMatch[1].length}>${processInline(hMatch[2])}</h${hMatch[1].length}>`); return;
      }

      // ── HR
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        flushP(); closeUl(); closeOl(); closeBq();
        output.push('<hr>'); return;
      }

      // ── Blockquote / callout
      const bqMatch = line.match(/^>\s?(.*)/);
      if (bqMatch) {
        flushP(); closeUl(); closeOl();
        inBq = true; bqLines.push(bqMatch[1]); return;
      } else if (inBq) { closeBq(); }

      // ── Unordered list
      const ulMatch = line.match(/^[\s]*[-*+]\s+(.*)/);
      if (ulMatch) {
        flushP(); closeOl(); closeBq();
        if (!inUl) { output.push('<ul>'); inUl = true; }
        output.push(`<li>${processInline(ulMatch[1])}</li>`); return;
      }

      // ── Ordered list
      const olMatch = line.match(/^\s*\d+\.\s+(.*)/);
      if (olMatch) {
        flushP(); closeUl(); closeBq();
        if (!inOl) { output.push('<ol>'); inOl = true; }
        output.push(`<li>${processInline(olMatch[1])}</li>`); return;
      }

      // ── Blank line
      if (line.trim() === '') { flushP(); closeUl(); closeOl(); closeBq(); flushTable(); return; }

      // ── Paragraph text
      closeUl(); closeOl(); closeBq();
      pLines.push(processInline(line));
    });

    flushP(); closeUl(); closeOl(); closeBq(); flushTable();
    return output.join('\n');
  };

  return parts.map(part => part.startsWith('<pre') ? part : processBlock(part)).join('');
}
