"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrandMark } from "./brand";

type Citation = {
  label: string;
  source: string;
  chunk_index: number;
  similarity: number;
  content: string;
};

type Attachment = {
  name: string;
  chunks: number;
  kind: "pdf" | "image" | "text";
};

type Message = {
  role: "user" | "bot";
  text: string;
  time: string;
  status?: string;
  citations?: Citation[];
  attachment?: Attachment;
};

type SessionDoc = {
  source: string;
  chunks: number;
  kind: Attachment["kind"];
};

type SavedChat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  sessionDocs: SessionDoc[];
  activeSource: string | null;
  pinned?: boolean;
  archived?: boolean;
};

type User = {
  email: string;
  name: string;
  token?: string;
  refreshToken?: string;
};

// Full intro — shown only the very first time a user opens the app.
const INTRO = `**Hello — I'm Vertex.**

A router picks the right helper for each message:

- **Docs agent** — answers from your uploads, with citations
- **Chat agent** — normal conversation
- **Weather agent** — weather questions

📎 Upload a file (or drag & drop it onto the chat), then ask. Images are read instantly via hosted Gemini OCR — no local server needed.`;

// Plain greeting — shown on New Chat and every later visit.
const GREETING = `**Hello — I'm Vertex.**

Ask me anything, or upload a file and I'll read it for you.`;

// Pool of ideas — a random 4 are shown each new chat so they never repeat.
// Kept self-explanatory: a brand-new user has no context for "leave",
// "handbook", "reimbursement" etc., so every prompt works on its own.
const SUGGESTION_POOL = [
  "What can you help me with?",
  "How do I get answers from my uploaded files?",
  "What kinds of files can I upload?",
  "Can you summarize a document for me?",
  "Explain how photosynthesis works",
  "What's the tallest mountain in the world?",
  "Give me a fun fact about the ocean",
  "Suggest a name for a pet cat",
  "Write me a short poem about rain",
  "Explain cloud computing simply",
  "Tell me something interesting about space",
  "Help me plan a small balcony garden",
  "Give me a quick pasta recipe",
  "What are some good habits for a morning routine?",
  "What should I pack for a beach trip?",
  "How do I find information faster?",
];

function pickSuggestions(): string[] {
  const pool = [...SUGGESTION_POOL];
  // Fisher–Yates shuffle, take 4.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 4);
}

const AUTH_KEY = "vertex-user";
const MAX_CHATS = 30;

type ThemePref = "dark" | "light" | "system";
type ResponseStyle = "default" | "concise" | "friendly" | "technical";
type ColorName =
  | "periwinkle"
  | "sagecream"
  | "terracotta"
  | "mauve"
  | "forest"
  | "olive"
  | "dustyblue"
  | "mocha"
  | "lavender";

const COLOR_NAMES: ColorName[] = [
  "periwinkle",
  "sagecream",
  "terracotta",
  "mauve",
  "forest",
  "olive",
  "dustyblue",
  "mocha",
  "lavender",
];

const COLOR_LABELS: Record<ColorName, string> = {
  periwinkle: "Periwinkle",
  sagecream: "Sage & Cream",
  terracotta: "Terracotta",
  mauve: "Mauve & Mist",
  forest: "Forest",
  olive: "Olive & Cream",
  dustyblue: "Dusty Blue",
  mocha: "Mocha & Sand",
  lavender: "Lavender",
};

const ACCENT_SHADES = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "grad-mid",
] as const;

type Palette = {
  accent: Record<string, string>;
  onAccent: string; // text color on accent buttons/bubbles (white palettes use dark)
  onSidebar: string; // text color on the light-mode sidebar & bottom bar
  status: string; // "Online" dot color (dark mode)
  bg: {
    tint1: string;
    tint2: string;
    light: string;
    dark: string; // dark-mode chat background (CSS gradient)
    sidebar: string; // dark-mode sidebar background
    sidebarLight: string; // light-mode sidebar background
  };
};

const PALETTES: Record<ColorName, Palette> = {
  // Default — a rich dusted periwinkle-grey on midnight indigo:
  //   #444477 chat canvas, #141433 sidebar/top bar, #F0F0FF text,
  //   #9898FC buttons, #7C7CF1 icons, #A0FFE0 "Online" dot.
  periwinkle: {
    accent: {
      "50": "241, 241, 255",
      "100": "232, 232, 254",
      "200": "213, 213, 253",
      "300": "188, 188, 252",
      "400": "170, 170, 252",
      "500": "152, 152, 252", // #9898FC — buttons, pills, send arrow, attach
      "600": "124, 124, 241", // #7C7CF1 — gear, initials, top-bar icons
      "700": "99, 99, 214",
      "800": "78, 78, 180",
      "grad-mid": "152, 152, 252",
    },
    onAccent: "#ffffff",
    onSidebar: "#2a2a52", // dark indigo on the near-white lavender sidebar
    status: "#A0FFE0",
    bg: {
      tint1: "rgba(152, 152, 252, .16)",
      tint2: "rgba(20, 20, 51, .38)",
      light: "#ececf7",
      dark: "linear-gradient(135deg, #33335c, #444477, #3b3b68)", // #444477 chat canvas
      sidebar: "rgba(20, 20, 51, .88)", // #141433 sidebar & top bar
      sidebarLight: "rgba(236, 236, 247, .92)",
    },
  },
  // Sage & Cream — muted sage sidebar #8A9A86, warm cream canvas #FAF8F5,
  // off-white cards, sage buttons, deep charcoal text.
  sagecream: {
    accent: {
      "50": "246, 247, 245",
      "100": "234, 237, 233",
      "200": "214, 220, 213",
      "300": "191, 199, 188",
      "400": "167, 179, 164",
      "500": "138, 154, 134",
      "600": "121, 136, 118",
      "700": "99, 111, 96",
      "800": "77, 86, 75",
      "grad-mid": "138, 154, 134",
    },
    onAccent: "#1d2418",
    onSidebar: "#faf8f3", // warm white on the sage sidebar
    status: "#22c55e",
    bg: {
      tint1: "rgba(138, 154, 134, .25)",
      tint2: "rgba(29, 34, 25, .35)",
      light: "#faf8f5",
      dark: "linear-gradient(135deg, #2c3227, #3a4234, #31382b)",
      sidebar: "rgba(29, 34, 25, .92)",
      sidebarLight: "#8a9a86",
    },
  },
  // Terracotta & Linen — terracotta rose sidebar #C88A75, blush linen
  // canvas #FAF0E6, peach message cards, espresso typography.
  terracotta: {
    accent: {
      "50": "251, 246, 244",
      "100": "245, 234, 230",
      "200": "236, 214, 207",
      "300": "225, 191, 179",
      "400": "214, 167, 152",
      "500": "200, 138, 117",
      "600": "176, 121, 103",
      "700": "144, 99, 84",
      "800": "112, 77, 66",
      "grad-mid": "200, 138, 117",
    },
    onAccent: "#2e1710",
    onSidebar: "#fff7f2", // warm white on the terracotta sidebar
    status: "#22c55e",
    bg: {
      tint1: "rgba(200, 138, 117, .22)",
      tint2: "rgba(56, 36, 25, .35)",
      light: "#faf0e6",
      dark: "linear-gradient(135deg, #382219, #4a2e20, #3e2719)",
      sidebar: "rgba(38, 24, 16, .92)",
      sidebarLight: "#c88a75",
    },
  },
  // Mauve & Mist — dusty mauve sidebar #9A8C9E, foggy slate canvas #F2F1F5,
  // soft plum cards, charcoal text.
  mauve: {
    accent: {
      "50": "247, 246, 247",
      "100": "237, 234, 238",
      "200": "220, 215, 221",
      "300": "199, 192, 202",
      "400": "179, 169, 182",
      "500": "154, 140, 158",
      "600": "136, 123, 139",
      "700": "111, 101, 114",
      "800": "86, 78, 88",
      "grad-mid": "154, 140, 158",
    },
    onAccent: "#241f26",
    onSidebar: "#f7f4f9", // near-white on the dusty mauve sidebar
    status: "#22c55e",
    bg: {
      tint1: "rgba(154, 140, 158, .22)",
      tint2: "rgba(28, 25, 31, .35)",
      light: "#f2f1f5",
      dark: "linear-gradient(135deg, #2a262e, #37313d, #2f2a34)",
      sidebar: "rgba(28, 25, 31, .92)",
      sidebarLight: "#9a8c9e",
    },
  },
  // Forest & Sand — deep forest olive sidebar #3D402B, vanilla sand canvas
  // #F5EFEB, muted sage accent buttons, dark olive typography.
  forest: {
    accent: {
      "50": "246, 247, 245",
      "100": "234, 237, 233",
      "200": "214, 220, 213",
      "300": "191, 199, 188",
      "400": "167, 179, 164",
      "500": "138, 154, 134",
      "600": "121, 136, 118",
      "700": "99, 111, 96",
      "800": "77, 86, 75",
      "grad-mid": "138, 154, 134",
    },
    onAccent: "#1d2418",
    onSidebar: "#f6f4ee", // near-white on the forest olive sidebar
    status: "#22c55e",
    bg: {
      tint1: "rgba(165, 170, 130, .20)",
      tint2: "rgba(38, 42, 27, .38)",
      light: "#f5efeb",
      dark: "linear-gradient(135deg, #232618, #2e3222, #272a1b)",
      sidebar: "rgba(38, 42, 27, .92)", // #3D402B forest olive (dark mode)
      sidebarLight: "#8a9a86", // soft sage in light mode for readable dark text
    },
  },
  // Olive & Cream — muted olive #737A52 sidebar, warm cream #F5F1E6 canvas,
  // soft olive accents #A5AA82, deep olive text #34382A.
  olive: {
    accent: {
      "50": "248, 248, 245",
      "100": "239, 240, 233",
      "200": "224, 225, 211",
      "300": "206, 208, 186",
      "400": "188, 191, 161",
      "500": "165, 170, 130",
      "600": "145, 150, 114",
      "700": "119, 122, 94",
      "800": "92, 95, 73",
      "grad-mid": "165, 170, 130",
    },
    onAccent: "#202412",
    onSidebar: "#f5f3e8", // warm cream-white on the olive sidebar
    status: "#22c55e",
    bg: {
      tint1: "rgba(165, 170, 130, .22)",
      tint2: "rgba(30, 33, 22, .36)",
      light: "#f5f1e6",
      dark: "linear-gradient(135deg, #2b2e20, #3a3f2c, #313529)",
      sidebar: "rgba(30, 33, 22, .92)",
      sidebarLight: "#737a52",
    },
  },
  // Dusty Blue & Warm White — dusty blue #7891A5 sidebar, warm white
  // #F7F7F4 canvas, soft blue accents, slate text #35434D.
  dustyblue: {
    accent: {
      "50": "244, 246, 248",
      "100": "231, 235, 239",
      "200": "208, 217, 224",
      "300": "181, 195, 206",
      "400": "154, 173, 188",
      "500": "120, 145, 165",
      "600": "106, 128, 145",
      "700": "86, 104, 119",
      "800": "67, 81, 92",
      "grad-mid": "120, 145, 165",
    },
    onAccent: "#1b242e",
    onSidebar: "#f3f7fa", // near-white on the dusty blue sidebar
    status: "#22c55e",
    bg: {
      tint1: "rgba(120, 145, 165, .25)",
      tint2: "rgba(28, 36, 43, .35)",
      light: "#f7f7f4",
      dark: "linear-gradient(135deg, #222c35, #313f4b, #2a3540)",
      sidebar: "rgba(28, 36, 43, .92)",
      sidebarLight: "#7891a5",
    },
  },
  // Mocha & Sand — deep mocha #68584D sidebar, cream #F4EFE8 canvas,
  // taupe accents, espresso text #302923.
  mocha: {
    accent: {
      "50": "247, 246, 245",
      "100": "237, 234, 232",
      "200": "220, 214, 210",
      "300": "201, 191, 184",
      "400": "181, 168, 158",
      "500": "156, 139, 126",
      "600": "137, 122, 111",
      "700": "112, 100, 91",
      "800": "87, 78, 71",
      "grad-mid": "156, 139, 126",
    },
    onAccent: "#211b15",
    onSidebar: "#f6f0e9", // cream-white on the deep mocha sidebar
    status: "#22c55e",
    bg: {
      tint1: "rgba(156, 139, 126, .22)",
      tint2: "rgba(32, 27, 22, .38)",
      light: "#f4efe8",
      dark: "linear-gradient(135deg, #2c2520, #3b312a, #322a24)",
      sidebar: "rgba(32, 27, 22, .92)",
      sidebarLight: "#68584d",
    },
  },
  // Lavender & Mushroom — muted lavender #9186A5 sidebar, mushroom #F1EEE9
  // canvas, dusty purple accents #B4ABC1, deep plum text #393442.
  lavender: {
    accent: {
      "50": "249, 248, 250",
      "100": "242, 240, 244",
      "200": "229, 226, 233",
      "300": "214, 209, 221",
      "400": "199, 192, 209",
      "500": "180, 171, 193",
      "600": "158, 150, 170",
      "700": "130, 123, 139",
      "800": "101, 96, 108",
      "grad-mid": "180, 171, 193",
    },
    onAccent: "#262030",
    onSidebar: "#f6f4fa", // near-white on the muted lavender sidebar
    status: "#22c55e",
    bg: {
      tint1: "rgba(180, 171, 193, .22)",
      tint2: "rgba(35, 31, 41, .36)",
      light: "#f1eee9",
      dark: "linear-gradient(135deg, #282430, #36313f, #2e2a36)",
      sidebar: "rgba(35, 31, 41, .92)",
      sidebarLight: "#9186a5",
    },
  },
};

function validColor(v: string | null, fallback: ColorName): ColorName {
  return COLOR_NAMES.includes(v as ColorName) ? (v as ColorName) : fallback;
}

const STYLE_LABELS: Record<ResponseStyle, string> = {
  default: "Default",
  concise: "Concise",
  friendly: "Friendly",
  technical: "Technical",
};

const STYLE_HINTS: Record<ResponseStyle, string> = {
  default: "Balanced answers",
  concise: "Short and to the point",
  friendly: "Warm, approachable tone",
  technical: "Precise, detail-heavy answers",
};

function storageKeyFor(email: string) {
  return `vertex-chats-${email.toLowerCase()}`;
}
function currentKeyFor(email: string) {
  return `vertex-current-${email.toLowerCase()}`;
}

function now() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileKind(name: string): Attachment["kind"] {
  const n = name.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|jfif|jpe)$/.test(n)) return "image";
  if (n.endsWith(".pdf")) return "pdf";
  return "text";
}

function isSupportedFile(file: File): boolean {
  const n = file.name.toLowerCase();
  const t = file.type || "";
  if (/\.(png|jpe?g|webp|gif|jfif|jpe)$/.test(n) || t.startsWith("image/"))
    return true;
  if (n.endsWith(".pdf") || t === "application/pdf") return true;
  if (/\.(txt|md)$/.test(n) || t.startsWith("text/")) return true;
  return false;
}

function kindIcon(kind: Attachment["kind"]) {
  if (kind === "image") return "🖼️";
  if (kind === "pdf") return "📄";
  return "📝";
}

/** Strip the server-side `u_<userId>__` source prefix for display. */
function displaySource(source: string) {
  const i = source.indexOf("__");
  return i > 0 && source.startsWith("u_") ? source.slice(i + 2) : source;
}

function deriveTitle(msgs: Message[]): string {
  const first = msgs.find((m) => m.role === "user" && m.text.trim());
  if (first) return first.text.trim().replace(/\s+/g, " ").slice(0, 42);
  const att = msgs.find((m) => m.attachment);
  if (att?.attachment) return att.attachment.name;
  return "New chat";
}

function timeAgo(ts: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function HistoryRow({
  c,
  currentChatId,
  menuState,
  setMenuState,
  openChat,
  togglePin,
  toggleArchive,
  deleteChat,
}: {
  c: SavedChat;
  currentChatId: string | null;
  menuState: { id: string; x: number; y: number } | null;
  setMenuState: (s: { id: string; x: number; y: number } | null) => void;
  openChat: (id: string) => void;
  togglePin: (id: string) => void;
  toggleArchive: (id: string) => void;
  deleteChat: (id: string) => void;
}) {
  const menuOpen = menuState?.id === c.id;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`history-item${c.id === currentChatId ? " active" : ""}`}
      title={c.title}
      onClick={() => openChat(c.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openChat(c.id);
        }
      }}
    >
      <span className="history-item-icon" aria-hidden>
        {c.pinned ? "📌" : "💬"}
      </span>
      <div className="history-item-meta">
        <div className="history-item-title">{c.title}</div>
        <div className="history-item-time">{timeAgo(c.updatedAt)}</div>
      </div>
      <div className="history-item-menu-wrap">
        <button
          type="button"
          className={`history-item-menu-btn${menuOpen ? " open" : ""}`}
          title="Chat options"
          aria-label={`Options for chat: ${c.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            if (menuOpen) {
              setMenuState(null);
            } else {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuState({ id: c.id, x: r.right, y: r.bottom });
            }
          }}
        >
          ⋮
        </button>
        {menuOpen && menuState && (
          <div
            className="history-item-menu"
            role="menu"
            style={{ left: menuState.x - 152, top: menuState.y + 6 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => togglePin(c.id)}
            >
              {c.pinned ? "📌 Unpin" : "📌 Pin"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => toggleArchive(c.id)}
            >
              {c.archived ? "📂 Unarchive" : "🗄️ Archive"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => deleteChat(c.id)}
            >
              🗑️ Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// react-markdown renders raw HTML escaped by default; only markdown links need
// hardening (open in a new tab, never pass the opener window along).
// Inline citation links (#cite-...) are rendered as pill buttons instead, so
// the sentence keeps flowing inside a single paragraph.
function makeMarkdownComponents(
  msgIndex: number,
  citations: Citation[],
  onJump: (msgIndex: number, citeIndex: number) => void
) {
  return {
    a: (props: {
      node?: unknown;
      href?: string;
      children?: React.ReactNode;
    }) => {
      const m = props.href?.match(/^#cite-(\d+)-(\d+)-(\d+)$/);
      if (m) {
        const n = parseInt(m[2], 10);
        const citeIdx = parseInt(m[3], 10);
        const cite = citations[citeIdx];
        return (
          <button
            type="button"
            className="cite-link"
            title={cite ? `Jump to ${displaySource(cite.source)}` : `Source ${n}`}
            aria-label={`Citation ${n}: ${
              cite ? displaySource(cite.source) : "source"
            }`}
            onClick={() => onJump(msgIndex, citeIdx)}
          >
            {n}
          </button>
        );
      }
      return (
        <a href={props.href} target="_blank" rel="noopener noreferrer">
          {props.children}
        </a>
      );
    },
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthUserLite = {
  email: string;
  name: string;
  token?: string;
  refreshToken?: string;
};


function AuthScreen({
  onAuthed,
}: {
  onAuthed: (user: AuthUserLite) => void;
}) {
  const [mode, setMode] = useState<
    "login" | "signup" | "verify" | "forgot" | "reset"
  >("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  // --- Email verification step (shared by signup verify + password reset) ---
  const [verifyEmail, setVerifyEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [codeLen, setCodeLen] = useState(6);
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    if (mode === "signup") nameRef.current?.focus();
    if (mode === "forgot") emailRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  // Auto-submit once all six digits are entered.
  useEffect(() => {
    if (mode === "verify" && code.every((d) => d) && !busy) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function switchMode(m: "login" | "signup") {
    setMode(m);
    setError(null);
    setNotice(null);
    setShowPw(false);
  }

  function handleCodeChange(i: number, val: string) {
    const digit = val.replace(/\D/g, "").slice(-1);
    setCode((prev) => {
      const next = [...prev];
      next[i] = digit;
      return next;
    });
    if (digit && i < codeLen - 1) codeRefs.current[i + 1]?.focus();
  }

  function handleCodeKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !code[i] && i > 0) {
      codeRefs.current[i - 1]?.focus();
    }
  }

  function handleCodePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, codeLen);
    if (!text) return;
    e.preventDefault();
    setCode(text.split("").concat(Array(codeLen).fill("")).slice(0, codeLen));
    codeRefs.current[Math.min(text.length, codeLen - 1)]?.focus();
  }

  async function verify() {
    const token = code.join("");
    if (token.length < 6 || busy) return;
    setBusy(true);
    setVerifyErr(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifyEmail, code: token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.user) {
        throw new Error(data.error || "Verification failed.");
      }
      onAuthed({
        ...data.user,
        token: data.token,
        refreshToken: data.refreshToken,
      });
    } catch (err) {
      setVerifyErr((err as Error).message);
      setShake(true);
      setCode(Array(6).fill(""));
      window.setTimeout(() => setShake(false), 600);
      codeRefs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (resendIn > 0 || resending) return;
    setResending(true);
    setVerifyErr(null);
    const isReset = mode === "reset";
    try {
      const res = await fetch(isReset ? "/api/auth/forgot" : "/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isReset
            ? { email: resetEmail }
            : { email: verifyEmail, name }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || "Could not resend the code.");
      }
      setResendIn(60);
    } catch (err) {
      setVerifyErr((err as Error).message);
    } finally {
      setResending(false);
    }
  }

  function renderCodeBoxes() {
    return (
      <div className={`code-boxes${shake ? " shake" : ""}`}>
        {code.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              codeRefs.current[i] = el;
            }}
            inputMode="numeric"
            maxLength={1}
            autoComplete="one-time-code"
            className="code-box"
            value={d}
            aria-label={`Verification digit ${i + 1}`}
            onChange={(e) => handleCodeChange(i, e.target.value)}
            onKeyDown={(e) => handleCodeKey(i, e)}
            onPaste={handleCodePaste}
          />
        ))}
      </div>
    );
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || "Could not send the code.");
      }
      const len = data.codeLength ?? 6;
      setResetEmail(em);
      setCodeLen(len);
      setCode(Array(len).fill(""));
      setVerifyErr(null);
      setResendIn(60);
      setPassword("");
      setConfirm("");
      setMode("reset");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setVerifyErr(null);
    const token = code.join("");
    if (token.length < codeLen) {
      setVerifyErr("Enter the full code from the email.");
      return;
    }
    if (password.length < 6) {
      setVerifyErr("New password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setVerifyErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: resetEmail,
          code: token,
          newPassword: password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || "Reset failed.");
      }
      setEmail(resetEmail);
      setPassword("");
      setConfirm("");
      setMode("login");
      setNotice("Password updated — sign in with your new password.");
    } catch (err) {
      setVerifyErr((err as Error).message);
      setShake(true);
      setCode(Array(codeLen).fill(""));
      window.setTimeout(() => setShake(false), 600);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const em = email.trim().toLowerCase();

    if (!EMAIL_RE.test(em)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (mode === "signup") {
      if (name.trim().length < 2) {
        setError("Please enter your name.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match.");
        return;
      }
      setBusy(true);
      try {
        const res = await fetch("/api/auth/send-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: em, name: name.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          throw new Error(data.error || "Could not send the code.");
        }
        const len = data.codeLength ?? 6;
        setVerifyEmail(em);
        setCodeLen(len);
        setCode(Array(len).fill(""));
        setVerifyErr(null);
        setResendIn(60);
        setMode("verify");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    } else {
      setBusy(true);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: em, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.user) {
          throw new Error(data.error || "Login failed.");
        }
        onAuthed({
          ...data.user,
          token: data.token,
          refreshToken: data.refreshToken,
        });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-blob b1" aria-hidden />
      <div className="auth-blob b2" aria-hidden />
      <div className="auth-blob b3" aria-hidden />
      <div className="auth-grid" aria-hidden />

      <div className="auth-card">
        <div className="auth-logo">
          <BrandMark large />
          <h1 className="auth-title" aria-label="Vertex">
            {"Vertex".split("").map((ch, i) => (
              <span key={i} style={{ animationDelay: `${0.06 * i}s` }}>
                {ch}
              </span>
            ))}
          </h1>
          <p>
            {mode === "verify" || mode === "forgot" || mode === "reset"
              ? "Check your inbox"
              : "Internal knowledge assistant"}
          </p>
        </div>

        {mode === "verify" ? (
          <div className="verify-step">
            <p className="verify-hint">
              We emailed a {codeLen}-digit code to <strong>{verifyEmail}</strong>.
              Enter it below to verify your account.
            </p>
            {renderCodeBoxes()}
            {verifyErr && (
              <div className="auth-error" role="alert">
                {verifyErr}
              </div>
            )}
            <button
              type="button"
              className="auth-submit"
              disabled={busy || code.some((d) => !d)}
              onClick={() => void verify()}
            >
              {busy ? "Verifying…" : "Verify & create account"}
            </button>
            <div className="resend-row">
              <button
                type="button"
                className="resend-btn"
                disabled={resendIn > 0 || resending}
                onClick={() => void resend()}
              >
                {resendIn > 0
                  ? `Resend code in ${resendIn}s`
                  : resending
                    ? "Sending…"
                    : "Resend code"}
              </button>
              <button
                type="button"
                className="auth-switch"
                onClick={() => setMode("signup")}
              >
                Change email
              </button>
            </div>
          </div>
        ) : mode === "forgot" ? (
          <form className="reset-step" onSubmit={submitForgot} noValidate>
            <p className="verify-hint">
              Enter your account email and we'll send a reset code to it.
            </p>
            <label className="auth-field">
              <span>Email</span>
              <input
                ref={emailRef}
                type="email"
                autoComplete="email"
                placeholder="you@peham.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset code"}
            </button>
            <div className="resend-row">
              <button
                type="button"
                className="auth-switch"
                onClick={() => switchMode("login")}
              >
                ← Back to sign in
              </button>
            </div>
          </form>
        ) : mode === "reset" ? (
          <form className="reset-step" onSubmit={submitReset} noValidate>
            <p className="verify-hint">
              We emailed a {codeLen}-digit reset code to{" "}
              <strong>{resetEmail}</strong>. Enter it, then choose a new
              password.
            </p>
            {renderCodeBoxes()}
            {verifyErr && (
              <div className="auth-error" role="alert">
                {verifyErr}
              </div>
            )}
            <label className="auth-field">
              <span>New password</span>
              <div className="pw-wrap">
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPw ? "🙈" : "👁️"}
                </button>
              </div>
            </label>
            <label className="auth-field">
              <span>Confirm new password</span>
              <div className="pw-wrap">
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
            </label>
            <button
              type="submit"
              className="auth-submit"
              disabled={busy || code.some((d) => !d)}
            >
              {busy ? "Resetting…" : "Reset password"}
            </button>
            <div className="resend-row">
              <button
                type="button"
                className="resend-btn"
                disabled={resendIn > 0 || resending}
                onClick={() => void resend()}
              >
                {resendIn > 0
                  ? `Resend code in ${resendIn}s`
                  : resending
                    ? "Sending…"
                    : "Resend code"}
              </button>
              <button
                type="button"
                className="auth-switch"
                onClick={() => setMode("forgot")}
              >
                Change email
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="auth-tabs" role="tablist" aria-label="Account access">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={`auth-tab${mode === "login" ? " active" : ""}`}
                onClick={() => switchMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={`auth-tab${mode === "signup" ? " active" : ""}`}
                onClick={() => switchMode("signup")}
              >
                Sign up
              </button>
            </div>

            <form onSubmit={submit} noValidate>
              {mode === "signup" && (
                <label className="auth-field">
                  <span>Name</span>
                  <input
                    ref={nameRef}
                    type="text"
                    autoComplete="name"
                    placeholder="Your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
              )}

              <label className="auth-field">
                <span>Email</span>
                <input
                  ref={emailRef}
                  type="email"
                  autoComplete="email"
                  placeholder="you@peham.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="auth-field">
                <span>Password</span>
                <div className="pw-wrap">
                  <input
                    type={showPw ? "text" : "password"}
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPw ? "🙈" : "👁️"}
                  </button>
                </div>
              </label>

              {mode === "login" && (
                <button
                  type="button"
                  className="forgot-link"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setMode("forgot");
                  }}
                >
                  Forgot password?
                </button>
              )}

              {mode === "signup" && (
                <label className="auth-field">
                  <span>Confirm password</span>
                  <div className="pw-wrap">
                    <input
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repeat your password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                    />
                  </div>
                </label>
              )}

              {notice && (
                <div className="auth-notice" role="status">
                  {notice}
                </div>
              )}

              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}

              <button type="submit" className="auth-submit" disabled={busy}>
                {busy
                  ? mode === "signup"
                    ? "Creating account…"
                    : "Signing in…"
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>

            <p className="auth-note">
              {mode === "signup"
                ? "Takes less than a minute — we'll email you a quick code to confirm it's really you."
                : "Welcome back — sign in with your email to pick up where you left off."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** A tiny mock of the full app page, drawn in a palette's colors, so users
 *  can see the whole theme before picking it. The mock mirrors the real
 *  layout: a sidebar on the left (1), and the chat side split into an upper
 *  top bar, the message canvas, and a lower input bar (2). */
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function ThemePreview({ palette, light }: { palette: Palette; light: boolean }) {
  const accent = palette.accent;
  const bg = palette.bg;
  // Sidebar/top-bar/input-bar text follows the palette's onSidebar color so
  // the mock stays readable on colored light sidebars; chat-canvas text uses
  // the neutral dark/light pair.
  const sideText = light ? hexToRgb(palette.onSidebar) : "240, 240, 255";
  const text = light ? "30, 41, 59" : "240, 240, 255"; // #F0F0FF in dark
  const sideBg = light ? bg.sidebarLight : bg.sidebar;
  const mainBg = light ? bg.light : bg.dark;
  const btnBg = `rgb(${accent["500"]})`;
  const btnColor = palette.onAccent;

  return (
    <span className="theme-screen" aria-hidden>
      {/* 1 — sidebar */}
      <span className="theme-screen-side" style={{ background: sideBg }}>
        <span
          className="theme-screen-logo"
          style={{ background: btnBg }}
        />
        <span
          className="theme-screen-newbtn"
          style={{ background: btnBg, color: btnColor }}
        >
          ＋
        </span>
        <span
          className="theme-screen-line"
          style={{ background: `rgba(${sideText}, .22)` }}
        />
        <span
          className="theme-screen-line"
          style={{ background: `rgba(${sideText}, .22)` }}
        />
        <span
          className="theme-screen-line theme-screen-line-short"
          style={{ background: `rgba(${sideText}, .22)` }}
        />
      </span>
      {/* 2 — chat side: upper bar, message canvas, lower input bar */}
      <span className="theme-screen-main">
        <span className="theme-screen-top" style={{ background: sideBg }}>
          <span
            className="theme-screen-title"
            style={{ color: `rgb(${sideText})` }}
          >
            Vertex
          </span>
          <span
            className="theme-screen-dot"
            style={{ background: palette.status }}
          />
        </span>
        <span className="theme-screen-msgs" style={{ background: mainBg }}>
          <span
            className="theme-screen-bubble"
            style={{ background: `rgba(${text}, .10)` }}
          >
            <span
              className="theme-screen-bubble-line"
              style={{ background: `rgba(${text}, .45)` }}
            />
          </span>
          <span
            className="theme-screen-bubble theme-screen-bubble-user"
            style={{ background: btnBg, color: btnColor }}
          >
            Hi
          </span>
        </span>
        <span className="theme-screen-input" style={{ background: sideBg }}>
          <span
            className="theme-screen-inputbar"
            style={{ background: `rgba(${sideText}, .12)` }}
          />
          <span
            className="theme-screen-send"
            style={{ background: btnBg, color: btnColor }}
          >
            ➤
          </span>
        </span>
      </span>
    </span>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "bot", text: GREETING, time: "" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<ThemePref>("dark");
  const [sysLight, setSysLight] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [style, setStyle] = useState<ResponseStyle>("default");
  const [saveHistory, setSaveHistory] = useState(true);
  const [accentColor, setAccentColor] = useState<ColorName>("periwinkle");
  // Effective light state — the theme picker only styles light mode; dark is fixed black.
  const light = theme === "light" || (theme === "system" && sysLight);
  const [sessionDocs, setSessionDocs] = useState<SessionDoc[]>([]);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [flashKey, setFlashKey] = useState<string>("");
  const [copiedKey, setCopiedKey] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(() =>
    pickSuggestions()
  );
  // Bumped on every new suggestion set so chips remount and re-animate.
  const [suggestionNonce, setSuggestionNonce] = useState(0);
  const [ownedDocs, setOwnedDocs] = useState<
    { name: string; chunks: number; size: number }[] | null
  >(null);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [waitingSecs, setWaitingSecs] = useState(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachWrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const chatIdRef = useRef<string | null>(null);
  const lastSavedFingerprint = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  // Latest session (token/refreshToken) for the silent-refresh machinery —
  // avoids stale closures in the fetch retry path.
  const userRef = useRef<User | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Set clock only on client — avoids SSR/client time mismatch hydration error
    setMessages([{ role: "bot", text: GREETING, time: now() }]);
    const storedTheme = localStorage.getItem("theme");
    setTheme(
      storedTheme === "light" ||
        storedTheme === "dark" ||
        storedTheme === "system"
        ? storedTheme
        : storedTheme === "true"
          ? "light"
          : "dark"
    );
    setStyle(
      (localStorage.getItem("resp-style") as ResponseStyle) || "default"
    );
    setSaveHistory(localStorage.getItem("save-history") !== "false");
    setAccentColor(
      validColor(
        localStorage.getItem("accent-color") ||
          localStorage.getItem("app-color"),
        "periwinkle"
      )
    );
    setSysLight(window.matchMedia("(prefers-color-scheme: light)").matches);
    setSidebarOpen(localStorage.getItem("sidebar-open") !== "false");

    // Restore the session + that user's saved chats.
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (raw) {
        const u = JSON.parse(raw) as User;
        if (u?.email) {
          userRef.current = u;
          setUser(u);
          loadChatsFor(u.email);
          scheduleTokenRefresh();
        }
      }
    } catch {
      // Corrupted storage — start fresh
    }
    setAuthChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadChatsFor(email: string) {
    try {
      const raw = localStorage.getItem(storageKeyFor(email));
      const parsed = raw ? (JSON.parse(raw) as SavedChat[]) : [];
      const valid = Array.isArray(parsed)
        ? parsed.filter((c) => c && c.id && Array.isArray(c.messages))
        : [];
      setChats(valid);
      const curId = localStorage.getItem(currentKeyFor(email));
      const cur = valid.find((c) => c.id === curId) ?? null;
      if (cur) {
        chatIdRef.current = cur.id;
        setCurrentChatId(cur.id);
        setMessages(cur.messages);
        setSessionDocs(cur.sessionDocs ?? []);
        setActiveSource(cur.activeSource ?? null);
        // Stamp the fingerprint so the auto-save effect no-ops on restore
        // (avoids bumping updatedAt and reordering the list on login/reload).
        lastSavedFingerprint.current = JSON.stringify({
          messages: cur.messages,
          sessionDocs: cur.sessionDocs ?? [],
          activeSource: cur.activeSource ?? null,
        });
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    document.body.classList.toggle(
      "light",
      theme === "light" || (theme === "system" && sysLight)
    );
    localStorage.setItem("theme", theme);
  }, [theme, sysLight]);

  // Follow OS theme preference while in "system" mode.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e: MediaQueryListEvent) => setSysLight(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    localStorage.setItem("resp-style", style);
    localStorage.setItem("save-history", String(saveHistory));
  }, [style, saveHistory]);

  // Apply the chosen accent palettes (app color + per-area overrides) as
  // CSS custom properties on <html>, so every var(--accent-*) picks them up.
  useEffect(() => {
    const root = document.documentElement.style;
    for (const shade of ACCENT_SHADES) {
      root.removeProperty(`--accent-${shade}`);
      root.removeProperty(`--sidebar-accent-${shade}`);
    }
    root.removeProperty("--bg-tint-1");
    root.removeProperty("--bg-tint-2");
    root.removeProperty("--bg-light");
    root.removeProperty("--bg-dark");
    root.removeProperty("--status-dot");
    root.removeProperty("--on-accent");
    root.removeProperty("--on-sidebar");
    root.removeProperty("--sidebar-bg");
    root.removeProperty("--sidebar-bg-light");
    root.removeProperty("--panel-bg");
    root.removeProperty("--panel-bg-light");

    // DARK MODE — the chosen theme's own dark look (each palette defines its
    // dark canvas + sidebar colors), so picking a theme changes dark mode too.
    // NOTE: --panel-bg (bubbles, input bar, settings drawer) stays a NEUTRAL
    // dark so those surfaces always contrast with the colored canvas — using
    // the palette's sidebar color there made bubbles blend into the canvas.
    if (!light) {
      const accent = PALETTES[accentColor];
      for (const shade of ACCENT_SHADES) {
        root.setProperty(`--accent-${shade}`, accent.accent[shade]);
        root.setProperty(`--sidebar-accent-${shade}`, accent.accent[shade]);
      }
      root.setProperty("--status-dot", accent.status);
      root.setProperty("--on-accent", accent.onAccent);
      root.setProperty("--on-sidebar", "#e8e8f5"); // light text on dark sidebar
      root.setProperty("--bg-tint-1", accent.bg.tint1);
      root.setProperty("--bg-tint-2", accent.bg.tint2);
      root.setProperty("--bg-light", accent.bg.light);
      root.setProperty("--bg-dark", accent.bg.dark);
      root.setProperty("--panel-bg", "rgba(15, 23, 42, .92)");
      root.setProperty("--panel-bg-light", "rgba(255, 255, 255, .92)");
      root.setProperty("--sidebar-bg", accent.bg.sidebar);
      root.setProperty("--sidebar-bg-light", accent.bg.sidebarLight);
      localStorage.setItem("accent-color", accentColor);
      return;
    }

    // LIGHT MODE — the chosen theme (its light look: cream canvas, pastel
    // sidebar, and matching buttons).
    const accent = PALETTES[accentColor];
    for (const shade of ACCENT_SHADES) {
      root.setProperty(`--accent-${shade}`, accent.accent[shade]);
      root.setProperty(`--sidebar-accent-${shade}`, accent.accent[shade]);
    }
    root.setProperty("--status-dot", accent.status);
    root.setProperty("--on-accent", accent.onAccent);
    root.setProperty("--on-sidebar", accent.onSidebar);

    // ONE full theme for the whole app — chat canvas, sidebar, top bar, and
    // input bar all come from the same palette.
    const bg = accent;
    root.setProperty("--bg-tint-1", bg.bg.tint1);
    root.setProperty("--bg-tint-2", bg.bg.tint2);
    root.setProperty("--bg-light", bg.bg.light);
    root.setProperty("--bg-dark", bg.bg.dark);
    // The input bar / message cards / settings sit ON the canvas, so they use
    // a NEUTRAL light surface (never the mid-tone sidebar color) — guarantees
    // dark readable text on every palette (olive, mocha, dusty blue, …).
    // The theme still shows in the sidebar, header, buttons and accents.
    root.setProperty("--panel-bg", bg.bg.sidebar);
    root.setProperty("--panel-bg-light", "rgba(255, 255, 255, .9)");
    root.setProperty("--sidebar-bg", bg.bg.sidebar);
    root.setProperty("--sidebar-bg-light", bg.bg.sidebarLight);

    localStorage.setItem("accent-color", accentColor);
  }, [accentColor, light]);

  useEffect(() => {
    // Reset the drag overlay if the drag is cancelled or the window loses focus
    const resetDrag = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragend", resetDrag);
    window.addEventListener("blur", resetDrag);
    return () => {
      window.removeEventListener("dragend", resetDrag);
      window.removeEventListener("blur", resetDrag);
    };
  }, []);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  /** Save the open conversation into localStorage (skips empty/streaming chats). */
  function persistCurrentChat() {
    if (!saveHistory) return;
    if (!user || loading || uploading) return;
    const meaningful = messages.some(
      (m) => m.role === "user" && (m.text.trim() || !!m.attachment)
    );
    if (!meaningful) return;

    const fingerprint = JSON.stringify({
      messages,
      sessionDocs,
      activeSource,
    });
    if (fingerprint === lastSavedFingerprint.current) return;
    lastSavedFingerprint.current = fingerprint;

    const id =
      chatIdRef.current ?? (chatIdRef.current = crypto.randomUUID());
    const prevEntry = chats.find((c) => c.id === id);
    const entry: SavedChat = {
      id,
      title: deriveTitle(messages),
      updatedAt: Date.now(),
      messages,
      sessionDocs,
      activeSource,
      pinned: prevEntry?.pinned,
      archived: prevEntry?.archived,
    };

    setChats((prev) => {
      const next = [entry, ...prev.filter((c) => c.id !== id)].slice(
        0,
        MAX_CHATS
      );
      try {
        localStorage.setItem(storageKeyFor(user.email), JSON.stringify(next));
      } catch {
        // storage full / unavailable — keep in memory only
      }
      return next;
    });

    if (currentChatId !== id) {
      setCurrentChatId(id);
      try {
        localStorage.setItem(currentKeyFor(user.email), id);
      } catch {
        // ignore
      }
    }
  }

  // Auto-save whenever the conversation settles (not while streaming/uploading).
  useEffect(() => {
    persistCurrentChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sessionDocs, activeSource, loading, uploading, user, saveHistory]);

  /** Session starts after email verification (signup) or a successful login. */
  function handleAuthed(u: AuthUserLite) {
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(u));
    } catch {
      // ignore
    }
    const nextUser: User = {
      email: u.email,
      name: u.name,
      token: u.token,
      refreshToken: u.refreshToken,
    };
    userRef.current = nextUser;
    setUser(nextUser);
    scheduleTokenRefresh();
    // The full intro shows only the first time; after that a plain greeting.
    const introSeen = localStorage.getItem(`vertex-intro-${u.email}`) === "1";
    setMessages([
      { role: "bot", text: introSeen ? GREETING : INTRO, time: now() },
    ]);
    setSuggestions(pickSuggestions());
    setSuggestionNonce((n) => n + 1);
    if (!introSeen) {
      try {
        localStorage.setItem(`vertex-intro-${u.email}`, "1");
      } catch {
        // ignore
      }
    }
    setSessionDocs([]);
    setActiveSource(null);
    setFlashKey("");
    setCopiedKey(null);
    chatIdRef.current = null;
    lastSavedFingerprint.current = "";
    setCurrentChatId(null);
    loadChatsFor(u.email);
  }

  /**
   * Exchange the stored refresh token for a fresh access-token pair.
   * Returns the new access token (and updates state + localStorage), or
   * null if the refresh token is gone/expired. Callers retry their failed
   * request once with the new token, then fall back to logout.
   */
  async function refreshTokenPair(): Promise<string | null> {
    const cur = userRef.current;
    if (!cur?.refreshToken) return null;
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: cur.refreshToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token || !data.refreshToken) return null;
      const next: User = {
        email: cur.email,
        name: cur.name,
        token: data.token,
        refreshToken: data.refreshToken,
      };
      userRef.current = next;
      setUser(next);
      try {
        localStorage.setItem(AUTH_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      scheduleTokenRefresh();
      return data.token as string;
    } catch {
      return null;
    }
  }

  /**
   * Proactively renew the access token ~5 minutes before it expires, so a
   * long chat session never hits a 401 mid-conversation. Also called after
   * every successful refresh to chain the next renewal. No-op without a
   * token or refresh token.
   */
  function scheduleTokenRefresh() {
    if (refreshTimerRef.current != null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    const cur = userRef.current;
    if (!cur?.token || !cur.refreshToken) return;
    let expMs = 0;
    try {
      const payload = JSON.parse(
        atob(cur.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
      ) as { exp?: number };
      expMs = (payload.exp ?? 0) * 1000;
    } catch {
      return; // not a JWT — fall back to 401-time refresh only
    }
    if (!expMs) return;
    // Refresh 5 minutes before expiry (never sooner than 1 minute out).
    const delay = Math.max(60_000, expMs - Date.now() - 5 * 60_000);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTokenPair().then((tok) => {
        // On success the pair refreshes; on failure leave the timer cleared —
        // the next 401 will attempt once more before logging out.
        if (tok) {
          // already rescheduled inside refreshTokenPair
        }
      });
    }, delay);
  }

  function handleLogout() {
    if (refreshTimerRef.current != null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    userRef.current = null;
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      // ignore
    }
    setUser(null);
    setChats([]);
    setMessages([{ role: "bot", text: GREETING, time: now() }]);
    setSessionDocs([]);
    setActiveSource(null);
    setFlashKey("");
    setCopiedKey(null);
    chatIdRef.current = null;
    lastSavedFingerprint.current = "";
    setCurrentChatId(null);
    setSidebarOpen(true);
  }

  function openChat(id: string) {
    persistCurrentChat();
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    chatIdRef.current = id;
    setCurrentChatId(id);
    setMessages(chat.messages);
    setSessionDocs(chat.sessionDocs ?? []);
    setActiveSource(chat.activeSource ?? null);
    // Stamp the fingerprint so the auto-save effect no-ops (no reorder bump).
    lastSavedFingerprint.current = JSON.stringify({
      messages: chat.messages,
      sessionDocs: chat.sessionDocs ?? [],
      activeSource: chat.activeSource ?? null,
    });
    setFlashKey("");
    setCopiedKey(null);
    try {
      if (user) localStorage.setItem(currentKeyFor(user.email), id);
    } catch {
      // ignore
    }
    if (window.innerWidth <= 768) setSidebarOpen(false);
  }

  function deleteChat(id: string) {
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      try {
        if (user) {
          localStorage.setItem(storageKeyFor(user.email), JSON.stringify(next));
        }
      } catch {
        // ignore
      }
      return next;
    });
    if (id === currentChatId) {
      chatIdRef.current = null;
      lastSavedFingerprint.current = "";
      setCurrentChatId(null);
      setMessages([{ role: "bot", text: GREETING, time: now() }]);
      setSessionDocs([]);
      setActiveSource(null);
      try {
        if (user) localStorage.removeItem(currentKeyFor(user.email));
      } catch {
        // ignore
      }
    }
  }

  function persistChats(next: SavedChat[]) {
    try {
      if (user) localStorage.setItem(storageKeyFor(user.email), JSON.stringify(next));
    } catch {
      // storage full / unavailable — keep in memory only
    }
  }

  function patchChat(id: string, patch: Partial<SavedChat>) {
    setChats((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
      persistChats(next);
      return next;
    });
  }

  function togglePin(id: string) {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    patchChat(id, { pinned: !chat.pinned });
  }

  function toggleArchive(id: string) {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    patchChat(id, { archived: !chat.archived });
  }

  // Close the chat ⋮ menu on outside click / Escape.
  useEffect(() => {
    if (!menuState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuState(null);
    };
    const close = () => setMenuState(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuState]);

  function setSidebar(open: boolean) {
    setSidebarOpen(open);
    try {
      localStorage.setItem("sidebar-open", String(open));
    } catch {
      // ignore
    }
  }

  function toggleSidebar() {
    setSidebarOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("sidebar-open", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Escape closes the settings drawer first, then the sidebar overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (settingsOpen) setSettingsOpen(false);
      else setSidebar(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  // Load this user's owned documents when Settings opens (Account section).
  useEffect(() => {
    if (!settingsOpen || !user?.token) return;
    let cancelled = false;
    (async () => {
      try {
        const doFetch = (token?: string) =>
          fetch("/api/ownership", {
            headers: { Authorization: `Bearer ${token}` },
          });
        let res = await doFetch(user.token);
        if (res.status === 401) {
          const newToken = await refreshTokenPair();
          if (newToken) res = await doFetch(newToken);
        }
        const data = await res.json().catch(() => ({}));
        if (!cancelled && !res.ok) {
          setOwnedDocs(null);
          return;
        }
        if (!cancelled && Array.isArray(data.myDocuments)) {
          setOwnedDocs(data.myDocuments);
        }
      } catch {
        if (!cancelled) setOwnedDocs(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, user]);

  async function uploadFile(file: File) {
    if (uploading) return; // ignore drops/uploads while one is in flight
    if (!isSupportedFile(file)) {
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text: "❌ Unsupported file type. Upload .txt, .md, .pdf, or an image (.png/.jpg/.webp).",
          time: now(),
        },
      ]);
      return;
    }

    const kind = fileKind(file.name);
    setUploading(true);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: "",
        time: now(),
        attachment: { name: file.name, chunks: 0, kind },
        status: "Starting upload…",
      },
    ]);

    const patchStatus = (status: string) => {
      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1] };
        if (last.role !== "user") return prev;
        last.status = status;
        copy[copy.length - 1] = last;
        return copy;
      });
    };

    const doUploadFetch = (token?: string) => {
      const form = new FormData();
      form.append("file", file);
      return fetch("/api/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
    };

    try {
      let res = await doUploadFetch(user?.token);
      if (res.status === 401) {
        // Access token expired — renew silently and retry once.
        const newToken = await refreshTokenPair();
        if (!newToken) {
          handleLogout();
          throw new Error("Session expired — sign in again.");
        }
        res = await doUploadFetch(newToken);
        if (res.status === 401) {
          handleLogout();
          throw new Error("Session expired — sign in again.");
        }
      }
      if (!res.body) throw new Error("No upload stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let donePayload: {
        source: string;
        chunks: number;
        preview?: string;
      } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            text?: string;
            source?: string;
            chunks?: number;
            preview?: string;
          };
          if (event.type === "status" && event.text) {
            patchStatus(event.text);
          } else if (event.type === "error") {
            throw new Error(event.text || "Upload failed");
          } else if (event.type === "done" && event.source) {
            donePayload = {
              source: event.source,
              chunks: event.chunks ?? 0,
              preview: event.preview,
            };
          }
        }
      }

      if (!donePayload) throw new Error("Upload finished with no result");

      const source = donePayload.source;
      const chunks = donePayload.chunks;
      const others = sessionDocs.filter((d) => d.source !== source);

      setSessionDocs([...others, { source, chunks, kind }]);
      setActiveSource(source);

      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1] };
        last.status = undefined;
        last.attachment = { name: displaySource(source), chunks, kind };
        copy[copy.length - 1] = last;
        copy.push({
          role: "bot",
          text:
            `Got it — indexed **${displaySource(source)}** (${chunks} chunks).\n\n` +
            (donePayload.preview
              ? `Preview: “${donePayload.preview.replace(/\s+/g, " ").trim()}${
                  donePayload.preview.length >= 280 ? "…" : ""
                }”\n\n`
              : "") +
            `I'll answer from this file by default. ` +
            (others.length > 0
              ? `Earlier in this chat: ${others
                  .map((o) => displaySource(o.source))
                  .join(", ")}. Name one or say “previous” to use an older file.`
              : `Upload another anytime — the newest becomes the default.`),
          time: now(),
        });
        return copy;
      });
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1] };
        last.status = undefined;
        last.text = `❌ Upload failed: ${(err as Error).message}`;
        copy[copy.length - 1] = last;
        return copy;
      });
    } finally {
      setUploading(false);
    }
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadFile(file);
  }

  // Attach menu: pick a file type, then open the file picker with the right
  // accept filter. The single hidden input lives in the DOM and we just swap
  // its `accept` before clicking it.
  const ATTACH_OPTIONS = [
    {
      key: "document",
      label: "Document",
      hint: ".txt · .md · .pdf",
      icon: "📄",
      accept: ".txt,.md,.pdf,text/plain,application/pdf",
    },
    {
      key: "image",
      label: "Image",
      hint: ".png · .jpg · .webp · .gif",
      icon: "🖼️",
      accept: ".png,.jpg,.jpeg,.webp,.gif,.jfif,image/*",
    },
  ] as const;

  function pickUpload(kind: (typeof ATTACH_OPTIONS)[number]["key"]) {
    setUploadMenuOpen(false);
    const input = fileInputRef.current;
    if (!input) return;
    const opt = ATTACH_OPTIONS.find((o) => o.key === kind);
    if (opt) input.accept = opt.accept;
    input.click();
  }

  // Close the attach menu on outside click / Escape.
  useEffect(() => {
    if (!uploadMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!attachWrapRef.current?.contains(e.target as Node)) {
        setUploadMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUploadMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [uploadMenuOpen]);

  // --- Drag & drop ---
  function onDragEnter(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragOver(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
  }

  function onDragLeave(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  function jumpToCitation(msgIndex: number, citeIndex: number) {
    const key = `cite-${msgIndex}-${citeIndex}`;
    document
      .getElementById(key)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashKey(key);
    window.setTimeout(
      () => setFlashKey((k) => (k === key ? "" : k)),
      1800
    );
  }

  async function copyMessage(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(i);
      window.setTimeout(() => setCopiedKey((k) => (k === i ? null : k)), 1500);
    } catch {
      // Clipboard unavailable — ignore
    }
  }

  function renderBotText(
    text: string,
    msgIndex: number,
    citations?: Citation[]
  ) {
    // Turn inline markers — [1] or [Source 1 | file] — into markdown links
    // (#cite-msgIndex-citeIndex). The `a` override renders those as citation
    // pills INSIDE the paragraph, so sentences keep flowing. Markers without
    // a matching citation are left as plain text.
    const markerRe = /\[Source\s*(\d+)[^\]]*\]|\[(\d+)\]/gi;
    const withLinks = text.replace(markerRe, (match, srcNum, bareNum) => {
      const n = srcNum ? parseInt(srcNum, 10) : parseInt(bareNum, 10);
      if (!citations?.[n - 1]) return match;
      return `[${n}](#cite-${msgIndex}-${n}-${n - 1})`;
    });
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={makeMarkdownComponents(
          msgIndex,
          citations ?? [],
          jumpToCitation
        )}
      >
        {withLinks}
      </ReactMarkdown>
    );
  }

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading || uploading) return;

    const sources = sessionDocs.map((d) => d.source);

    // History before this new user message (for follow-ups like "and private notes").
    // Strip citation markers so the model doesn't reuse stale [n] numbers.
    // When editing, only keep messages before the edited one — the old reply
    // being replaced must not leak into the new context.
    const historyBase =
      editingIndex != null ? messages.slice(0, editingIndex) : messages;
    const history = historyBase
      .filter((m) => (m.role === "user" || m.role === "bot") && m.text.trim())
      .filter((m) => !m.text.startsWith("❌"))
      .slice(-8)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("bot" as const),
        text: m.text.replace(/\[Source\s*\d+[^\]]*\]|\[\d+\]/gi, ""),
      }));

    setInput("");
    setLoading(true);
    setWaitingSecs(0);
    setMessages((prev) => {
      // Editing: replace the edited message (keeping any attachment) and drop
      // its old reply (and anything after) — the new reply streams below it.
      const edited = editingIndex != null ? prev[editingIndex] : undefined;
      const base = editingIndex != null ? prev.slice(0, editingIndex) : prev;
      return [
        ...base,
        {
          role: "user",
          text,
          time: now(),
          ...(edited?.attachment ? { attachment: edited.attachment } : {}),
        },
        { role: "bot", text: "", time: now(), status: "Thinking…" },
      ];
    });
    if (editingIndex != null) setEditingIndex(null);

    // Elapsed-seconds ticker so a slow response never looks frozen.
    const elapsedTimer = window.setInterval(
      () => setWaitingSecs((s) => s + 1),
      1000
    );

    // Hard cap: if the server is dead or stuck, fail loudly instead of
    // spinning forever (dev cold-compiles /api/chat ~10-16s on first hit).
    // The same controller powers the user-facing "Stop generating" button.
    const controller = new AbortController();
    abortRef.current = controller;
    stoppedRef.current = false;
    const abortTimer = window.setTimeout(
      () => controller.abort(),
      90_000
    );

    const chatBody = JSON.stringify({
      message: text,
      source: activeSource,
      sources,
      history,
      style,
    });
    const doChatFetch = (token?: string) =>
      fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: chatBody,
        signal: controller.signal,
      });

    try {
      let res = await doChatFetch(user?.token);
      if (res.status === 401) {
        // Access token expired — renew silently and retry once.
        const newToken = await refreshTokenPair();
        if (!newToken) {
          handleLogout();
          throw new Error("Session expired — sign in again.");
        }
        res = await doChatFetch(newToken);
        if (res.status === 401) {
          handleLogout();
          throw new Error("Session expired — sign in again.");
        }
      }
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            text?: string;
            name?: string;
            citations?: Citation[];
          };

          setMessages((prev) => {
            const copy = [...prev];
            const last = { ...copy[copy.length - 1] };
            if (last.role !== "bot") return prev;

            if (event.type === "status" && event.text) {
              last.status = event.text;
            } else if (event.type === "tool" && event.name) {
              last.status = `🔧 ${event.name}`;
            } else if (event.type === "token" && event.text) {
              last.status = undefined;
              last.text = (last.text || "") + event.text;
            } else if (event.type === "done") {
              last.status = undefined;
              last.citations = event.citations ?? [];
            } else if (event.type === "error" && event.text) {
              last.status = undefined;
              last.text = `❌ ${event.text}`;
            }

            copy[copy.length - 1] = last;
            return copy;
          });
        }
      }
    } catch (err) {
      const timedOut = (err as Error).name === "AbortError";
      // Pure updater: never mutate prev's objects (React may invoke the
      // updater more than once in dev, and mutating made the note append
      // twice). Spread a fresh object and make the suffix idempotent.
      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1] };
        if (stoppedRef.current) {
          // Keep whatever streamed in so far, just mark it as stopped.
          last.status = undefined;
          const base = (last.text || "").replace(/\n\n_⏹ Stopped\._$/g, "");
          last.text = `${base}\n\n_⏹ Stopped._`;
        } else {
          last.text = timedOut
            ? "❌ The request timed out after 90s — the server may have restarted mid-request. Try again; if it keeps timing out, check the dev server is running."
            : "❌ Unable to connect. Make sure the server is running and .env.local is set.";
        }
        last.time = now();
        copy[copy.length - 1] = last;
        return copy;
      });
    } finally {
      window.clearTimeout(abortTimer);
      window.clearInterval(elapsedTimer);
      abortRef.current = null;
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function stopGenerating() {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }

  function newChat() {
    persistCurrentChat();
    chatIdRef.current = null;
    lastSavedFingerprint.current = "";
    setCurrentChatId(null);
    setMessages([{ role: "bot", text: GREETING, time: now() }]);
    setSuggestions(pickSuggestions());
    setSuggestionNonce((n) => n + 1);
    setSessionDocs([]);
    setActiveSource(null);
    setFlashKey("");
    setCopiedKey(null);
    try {
      if (user) localStorage.removeItem(currentKeyFor(user.email));
    } catch {
      // ignore
    }
    inputRef.current?.focus();
  }

  const remaining = 2000 - input.length;
  const showSuggestions =
    messages.length === 1 && !loading && !uploading && !dragging;

  if (!authChecked) {
    return (
      <div className="boot-screen">
        <BrandMark large />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen onAuthed={handleAuthed} />
    );
  }

  return (
    <div className={`container${sidebarOpen ? "" : " sidebar-collapsed"}`}>
      <aside className="sidebar">
        <div className="logo">
          <BrandMark />
          <div className="logo-text">
            <h2>Vertex</h2>
          </div>
        </div>

        <button className="new-chat" onClick={newChat}>
          + New Chat
        </button>

        <nav className="history" aria-label="Past chats">
          <div className="sidebar-section-title">Chats</div>
          {chats.length === 0 ? (
            <div className="history-empty">
              No past chats yet — conversations save here automatically.
            </div>
          ) : (
            <>
              <div className="history-list">
                {chats
                  .filter((c) => !c.archived)
                  .sort((a, b) => {
                    if (!!a.pinned !== !!b.pinned)
                      return a.pinned ? -1 : 1;
                    return b.updatedAt - a.updatedAt;
                  })
                  .map((c) => (
                    <HistoryRow
                      key={c.id}
                      c={c}
                      currentChatId={currentChatId}
                      menuState={menuState}
                      setMenuState={setMenuState}
                      openChat={openChat}
                      togglePin={togglePin}
                      toggleArchive={toggleArchive}
                      deleteChat={deleteChat}
                    />
                  ))}
              </div>
              {chats.some((c) => c.archived) && (
                <>
                  <div className="sidebar-section-title">Archived</div>
                  <div className="history-list">
                    {chats
                      .filter((c) => c.archived)
                      .sort((a, b) => b.updatedAt - a.updatedAt)
                      .map((c) => (
                        <HistoryRow
                          key={c.id}
                          c={c}
                          currentChatId={currentChatId}
                          menuState={menuState}
                          setMenuState={setMenuState}
                          openChat={openChat}
                          togglePin={togglePin}
                          toggleArchive={toggleArchive}
                          deleteChat={deleteChat}
                        />
                      ))}
                  </div>
                </>
              )}
            </>
          )}
        </nav>

        {sessionDocs.length > 0 && (
          <div className="session-docs">
            <div className="session-docs-title">In this chat</div>
            {sessionDocs.map((d) => (
              <button
                key={d.source}
                type="button"
                className={`session-doc${
                  d.source === activeSource ? " active" : ""
                }`}
                title={`Use ${displaySource(d.source)}`}
                onClick={() => setActiveSource(d.source)}
              >
                <span>{kindIcon(d.kind)}</span>
                <span className="session-doc-name">
                  {displaySource(d.source)}
                </span>
              </button>
            ))}
          </div>
        )}

      </aside>

      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <main
        className="chat-section"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <header>
          <div className="header-left">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-expanded={sidebarOpen}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="9" y1="4" x2="9" y2="20" />
                <line x1="13" y1="9" x2="17" y2="9" />
                <line x1="13" y1="14" x2="17" y2="14" />
              </svg>
            </button>
            <div className="brand">
              <BrandMark />
              <h2>Vertex</h2>
            </div>
            <span className="status">
              <span className="status-dot" />
              Online
            </span>
          </div>
          <div className="header-right">
            <div className="user-chip" title={user.email}>
              <span className="user-avatar" aria-hidden>
                <img src="/logo.png" alt="" className="user-avatar-img" />
              </span>
              <span className="user-name">{user.name}</span>
            </div>
            <button
              type="button"
              className="settings-btn"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </header>

        <div id="chat" className="chat-box" ref={chatRef}>
          {messages.map((m, i) => {
            const isEmptyBot =
              m.role === "bot" &&
              !m.text &&
              !m.attachment &&
              loading &&
              i === messages.length - 1;
            const isStreaming =
              m.role === "bot" &&
              !m.status &&
              !!m.text &&
              loading &&
              i === messages.length - 1;
            return (
              <div key={i} className={`message ${m.role}`}>
                <div className="avatar">
                  {m.role === "user" ? (
                    "👤"
                  ) : (
                    <img src="/logo.png" alt="Vertex" className="avatar-img" />
                  )}
                </div>
                <div className="content">
                  <div className="name">
                    {m.role === "user" ? "You" : "Vertex"}
                  </div>
                  {m.status && (
                    <div className="tool-status">
                      {m.status}
                      {isEmptyBot && waitingSecs > 8
                        ? ` · ${waitingSecs}s`
                        : ""}
                    </div>
                  )}
                  {m.attachment && (
                    <div className={`chat-attach kind-${m.attachment.kind}`}>
                      <span className="chat-attach-icon" aria-hidden>
                        {kindIcon(m.attachment.kind)}
                      </span>
                      <div className="chat-attach-meta">
                        <div className="chat-attach-name">
                          {m.attachment.name}
                        </div>
                        <div className="chat-attach-sub">
                          {m.attachment.chunks > 0
                            ? `${m.attachment.chunks} chunks indexed`
                            : m.status
                              ? "Indexing…"
                              : "Document"}
                        </div>
                      </div>
                    </div>
                  )}
                  {isEmptyBot && !m.status ? (
                    <div className="bubble typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : m.text ? (
                    <div className="bubble-wrap">
                      <div
                        className={`bubble ${m.role === "bot" ? "markdown" : ""}`}
                      >
                        {m.role === "bot"
                          ? renderBotText(m.text, i, m.citations)
                          : m.text}
                        {isStreaming && <span className="stream-cursor" />}
                      </div>
                      {m.role === "bot" && m.text && !m.status && (
                        <button
                          type="button"
                          className={`copy-btn${
                            copiedKey === i ? " copied" : ""
                          }`}
                          title="Copy answer"
                          aria-label="Copy answer"
                          onClick={() => copyMessage(i, m.text)}
                        >
                          {copiedKey === i ? "✓" : "⧉"}
                        </button>
                      )}
                      {m.role === "user" && !m.status && (
                        <button
                          type="button"
                          className={`edit-btn${
                            editingIndex === i ? " active" : ""
                          }`}
                          title="Edit and resend"
                          aria-label="Edit and resend"
                          onClick={() => {
                            setEditingIndex(i);
                            setInput(m.text);
                            inputRef.current?.focus();
                          }}
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  ) : null}
                  {m.citations && m.citations.length > 0 && (
                    <div className="citations">
                      <div className="citations-title">
                        Sources
                        {m.citations.length > 1
                          ? ` (${m.citations.length})`
                          : ""}
                      </div>
                      {m.citations.map((c, ci) => {
                        const citeKey = `cite-${i}-${ci}`;
                        const clipped = c.content.slice(0, 260);
                        const isLong = c.content.length > 260;
                        return (
                          <div
                            key={citeKey}
                            id={citeKey}
                            className={`citation${
                              flashKey === citeKey ? " flash" : ""
                            }`}
                          >
                            <div className="citation-head">
                              <span className="citation-num">{ci + 1}</span>
                              <span className="citation-file">
                                {displaySource(c.source)}
                              </span>
                              <span className="citation-chunk">
                                chunk {c.chunk_index + 1}
                              </span>
                              <span
                                className="citation-match"
                                title="Retrieval similarity"
                              >
                                {c.similarity}% match
                              </span>
                            </div>
                            {isLong ? (
                              <details className="citation-details">
                                <summary>{clipped}…</summary>
                                <p>{c.content}</p>
                              </details>
                            ) : (
                              <p>{c.content}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="timestamp" suppressHydrationWarning>
                    {m.time}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="input-area">
          {showSuggestions && (
            <div className="welcome-area">
              <div className="welcome-title">Try asking</div>
              <div className="suggestions">
                {suggestions.map((s, i) => (
                  <button
                    key={`${suggestionNonce}-${i}`}
                    type="button"
                    className="suggestion-chip"
                    style={{ "--i": i } as React.CSSProperties}
                    onClick={() => void send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {activeSource && (
            <div className="active-doc-hint">
              Answering from <strong>{activeSource}</strong>
              {sessionDocs.length > 1
                ? " · name another file or pick one in the sidebar"
                : ""}
            </div>
          )}
          {editingIndex != null && (
            <div className="edit-banner">
              <span className="edit-banner-icon" aria-hidden>
                ✎
              </span>
              <span className="edit-banner-text">
                Editing your message — press Enter to resend
              </span>
              <button
                type="button"
                className="edit-cancel"
                onClick={() => {
                  setEditingIndex(null);
                  setInput("");
                }}
                aria-label="Cancel editing"
                title="Cancel editing"
              >
                ✕
              </button>
            </div>
          )}
          <div className="input-row">
            <input
              ref={inputRef}
              value={input}
              maxLength={2000}
              aria-label="Type your message"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                editingIndex != null
                  ? "Edit your message…"
                  : activeSource
                    ? `Ask about ${activeSource}…`
                    : "Upload a doc, then ask…"
              }
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp,.gif,.jfif,text/plain,application/pdf,image/*"
              onChange={onUpload}
              disabled={uploading}
              className="file-input-hidden"
              style={{ display: "none" }}
              tabIndex={-1}
              aria-hidden
            />
            <div className="attach-wrap" ref={attachWrapRef}>
              <button
                type="button"
                className={`attach-btn${uploadMenuOpen ? " open" : ""}`}
                title="Upload a document or image"
                aria-label="Upload a document or image"
                aria-haspopup="menu"
                aria-expanded={uploadMenuOpen}
                disabled={uploading || loading}
                onClick={() => setUploadMenuOpen((v) => !v)}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>

              {uploadMenuOpen && (
                <div
                  className="attach-menu"
                  role="menu"
                  aria-label="Upload type"
                >
                  <div className="attach-menu-title">Upload</div>
                  {ATTACH_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      role="menuitem"
                      className="attach-option"
                      onClick={() => pickUpload(o.key)}
                    >
                      <span className="attach-option-icon" aria-hidden>
                        {o.icon}
                      </span>
                      <span className="attach-option-text">
                        <span className="attach-option-name">{o.label}</span>
                        <span className="attach-option-hint">{o.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {loading ? (
              <button
                type="button"
                className="stop-btn"
                onClick={stopGenerating}
                aria-label="Stop generating"
                title="Stop generating"
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <rect
                    x="4.75"
                    y="4.75"
                    width="14.5"
                    height="14.5"
                    rx="3.5"
                    fill="currentColor"
                    stroke="rgba(255, 255, 255, .45)"
                    strokeWidth="1.3"
                  />
                </svg>
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={() => void send()}
                disabled={uploading}
                aria-label="Send"
              >
                ➜
              </button>
            )}
          </div>
          <div className="input-footer">
            <span className="char-counter">
              {remaining} characters remaining
            </span>
          </div>
        </div>

        {dragging && (
          <div className="drop-overlay" aria-hidden>
            <div className="drop-card">
              <span className="drop-icon">📎</span>
              <span>Drop your file to index it</span>
              <span className="drop-sub">.txt · .md · .pdf · images</span>
            </div>
          </div>
        )}
      </main>

      {settingsOpen && (
        <div
          className="settings-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
        >
          <div
            className="settings-backdrop"
            onClick={() => setSettingsOpen(false)}
            aria-hidden
          />
          <div className="settings-drawer">
            <div className="settings-header">
              <h3>Settings</h3>
              <button
                type="button"
                className="settings-close"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
              >
                ✕
              </button>
            </div>

            <div className="settings-body">
              <section className="settings-section">
                <div className="settings-section-title">Appearance</div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-name">Theme</div>
                    <div className="settings-row-hint">
                      Dark, light, or match your device
                    </div>
                  </div>
                  <div className="segmented" role="radiogroup" aria-label="Theme">
                    {(["dark", "light", "system"] as ThemePref[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={theme === t}
                        className={`segmented-btn${theme === t ? " active" : ""}`}
                        onClick={() => setTheme(t)}
                      >
                        {t === "dark" ? "Dark" : t === "light" ? "Light" : "System"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-name">Theme</div>
                    <div className="settings-row-hint">
                      One complete look — sidebar, chat &amp; buttons together
                    </div>
                  </div>
                  <div
                    className="preview-row"
                    role="radiogroup"
                    aria-label="Theme"
                  >
                    {COLOR_NAMES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={accentColor === c}
                        className={`theme-preview${accentColor === c ? " active" : ""}`}
                        title={COLOR_LABELS[c]}
                        aria-label={`Theme: ${COLOR_LABELS[c]}`}
                        onClick={() => setAccentColor(c)}
                      >
                        <ThemePreview palette={PALETTES[c]} light={light} />
                        <span className="theme-preview-label">
                          {COLOR_LABELS[c]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-row">
                  <button
                    type="button"
                    className="reset-colors-btn"
                    onClick={() => setAccentColor("periwinkle")}
                  >
                    ↺ Reset to default theme
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">Assistant</div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-name">Response style</div>
                    <div className="settings-row-hint">
                      How Vertex should phrase its answers
                    </div>
                  </div>
                  <div className="style-list" role="radiogroup" aria-label="Response style">
                    {(Object.keys(STYLE_LABELS) as ResponseStyle[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={style === s}
                        className={`style-option${style === s ? " active" : ""}`}
                        onClick={() => setStyle(s)}
                      >
                        <span className="style-option-name">{STYLE_LABELS[s]}</span>
                        <span className="style-option-hint">{STYLE_HINTS[s]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">Privacy</div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-name">Save chat history</div>
                    <div className="settings-row-hint">
                      Keep conversations in this browser so you can reopen them
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={saveHistory}
                    className={`switch${saveHistory ? " on" : ""}`}
                    onClick={() => setSaveHistory((v) => !v)}
                    aria-label="Save chat history"
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">Account</div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-name">Signed in as</div>
                    <div className="settings-row-hint">{user?.email}</div>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-name">Your documents</div>
                    <div className="settings-row-hint">
                      Files only you can see, stored in your private bucket
                    </div>
                  </div>
                </div>
                <div className="ownership-list">
                  {ownedDocs === null ? (
                    <div className="ownership-empty">Loading…</div>
                  ) : ownedDocs.length === 0 ? (
                    <div className="ownership-empty">
                      No documents uploaded yet — upload a file to see it here.
                    </div>
                  ) : (
                    ownedDocs.map((d) => (
                      <div className="ownership-item" key={d.name}>
                        <span className="ownership-item-icon" aria-hidden>
                          {kindIcon(
                            d.name.toLowerCase().includes(".pdf")
                              ? "pdf"
                              : /\.(png|jpe?g|webp|gif|jfif)$/.test(
                                    d.name.toLowerCase()
                                  )
                                ? "image"
                                : "text"
                          )}
                        </span>
                        <span className="ownership-item-meta">
                          <span className="ownership-item-name">
                            {d.name}
                          </span>
                          <span className="ownership-item-sub">
                            {d.size} chunk{d.size === 1 ? "" : "s"} · yours
                            only
                          </span>
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <div className="settings-row">
                  <button
                    type="button"
                    className="signout-btn"
                    onClick={handleLogout}
                  >
                    ⏻ Sign out
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
