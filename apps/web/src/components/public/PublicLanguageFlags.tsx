/** Local SVG language marks — not citizenship or currency. No remote image APIs. */

export function EnglishLangFlag() {
  return (
    <svg className="nx-public-lang__flag" viewBox="0 0 60 30" aria-hidden="true" focusable="false">
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 60,30 M60,0 0,30" stroke="#fff" strokeWidth="9" />
      <path d="M0,0 60,30 M60,0 0,30" stroke="#C8102E" strokeWidth="5" />
      <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="15" />
      <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="9" />
    </svg>
  );
}

export function HebrewLangFlag() {
  return (
    <svg className="nx-public-lang__flag" viewBox="0 0 60 30" aria-hidden="true" focusable="false">
      <rect width="60" height="30" fill="#fff" />
      <rect y="3" width="60" height="4.2" fill="#0038b8" />
      <rect y="22.8" width="60" height="4.2" fill="#0038b8" />
      <polygon
        points="30,8.2 23.2,20.2 36.8,20.2"
        fill="none"
        stroke="#0038b8"
        strokeWidth="1.7"
        strokeLinejoin="miter"
      />
      <polygon
        points="30,22.2 23.2,10.2 36.8,10.2"
        fill="none"
        stroke="#0038b8"
        strokeWidth="1.7"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
