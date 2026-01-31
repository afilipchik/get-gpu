import { Highlight, Prism, themes } from "prism-react-renderer";

// Register bash/shell grammar with the bundled Prism instance
(Prism as any).languages.bash = {
  shebang: { pattern: /^#!\/.+/, greedy: true, alias: "important" },
  comment: { pattern: /(^|[^'{\\])#.*/, lookbehind: true },
  string: [
    {
      pattern: /\$'(?:[^'\\]|\\[\s\S])*'/,
      greedy: true,
    },
    {
      pattern: /\$"(?:[^"\\]|\\[\s\S])*"/,
      greedy: true,
    },
    {
      pattern: /"(?:[^"\\]|\\[\s\S])*"/,
      greedy: true,
    },
    {
      pattern: /'[^']*'/,
      greedy: true,
    },
  ],
  variable: /\$(?:\w+|[!#$*+\-?@]|\{[^}]+\})/,
  keyword:
    /\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|export|source|local|readonly|declare|set|unset|shift|trap|eval|exec)\b/,
  builtin:
    /\b(?:cd|echo|printf|read|test|cat|ls|grep|sed|awk|mkdir|rm|cp|mv|chmod|chown|curl|wget|pip|apt|yum|brew|npm|git|docker|python|bash|sh)\b/,
  function: /\b\w+(?=\s*\()/,
  number: /\b\d+\b/,
  operator: /&&|\|\||[<>]=?|[!=]=|--|[&|^~]/,
  punctuation: /[(){}[\];,]/,
};
(Prism as any).languages.shell = (Prism as any).languages.bash;

interface BashHighlightProps {
  code: string;
  style?: React.CSSProperties;
}

export default function BashHighlight({ code, style }: BashHighlightProps) {
  return (
    <Highlight theme={themes.vsDark} code={code} language="bash">
      {({ tokens, getLineProps, getTokenProps }) => (
        <code style={style}>
          {tokens.map((line, i) => (
            <span key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
              {"\n"}
            </span>
          ))}
        </code>
      )}
    </Highlight>
  );
}
