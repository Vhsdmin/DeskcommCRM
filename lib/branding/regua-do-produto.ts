/**
 * A régua do design system, congelada em módulo — a fonte da derivação em RUNTIME.
 *
 * POR QUE ESTE ARQUIVO EXISTE, e não um `readFileSync("app/globals.css")`:
 *
 * A imagem de produção é `output: "standalone"` (next.config.ts) e o Dockerfile
 * copia para o runner apenas `.next/standalone`, `.next/static` e `public/`. O
 * `app/globals.css` NÃO existe no contêiner que o self-hoster roda. Um
 * `readFileSync` no caminho de render do `app/layout.tsx` daria ENOENT — 500 em
 * todas as telas, na VPS de quem a feature existe para servir, e verde em dev,
 * em teste e na Vercel. É o mesmo modo de falha que `lib/branding.ts` documenta
 * para o `NEXT_PUBLIC_*`.
 *
 * A separação também é a certa conceitualmente: a RÉGUA é do produto e nasce
 * congelada no build; a COR é da instalação e só existe em runtime. Só a segunda
 * precisa ser lida do ambiente.
 *
 * ESTE ARQUIVO É GERADO. Não edite à mão: ele é o `extrairRegua()` aplicado ao
 * `app/globals.css`. `tests/unit/branding-regua-do-produto.test.ts` compara os
 * dois a cada run e imprime o literal novo na mensagem de falha — mexeu na
 * paleta, o teste reprova e entrega o texto para colar aqui.
 */

import type { Regua } from "./contraste";

export const REGUA_DO_PRODUTO: Regua = {
  rampaDoProduto: [
    "#e8fef1",
    "#c9fcdf",
    "#97f9c2",
    "#5cf79e",
    "#0bf372",
    "#04d361",
    "#00b359",
    "#049366",
    "#037a55",
    "#065f45",
    "#04231a",
  ],
  claro: {
    nome: "claro",
    base: [
      {
        chave: "--color-bg",
        hex: "#f8f9fa",
      },
      {
        chave: "--color-surface",
        hex: "#ffffff",
      },
      {
        chave: "--color-surface-elevated",
        hex: "#f2f4f7",
      },
    ],
    tingidas: [
      {
        chave: "--color-accent-soft",
        fonte: {
          tipo: "grau",
          indice: 0,
          alfa: 1,
        },
      },
    ],
    papeis: [
      {
        token: "--color-accent",
        tipo: "componente",
        fonte: {
          tipo: "grau",
          indice: 8,
          alfa: 1,
        },
        contra: null,
      },
      {
        token: "--color-accent-fg",
        tipo: "texto",
        fonte: {
          tipo: "frenteCalculada",
          sobre: {
            tipo: "grau",
            indice: 8,
            alfa: 1,
          },
        },
        contra: [
          {
            tipo: "grau",
            indice: 8,
            alfa: 1,
          },
        ],
      },
      {
        token: "--color-accent-hover",
        tipo: "componente",
        fonte: {
          tipo: "grau",
          indice: 9,
          alfa: 1,
        },
        contra: null,
      },
      {
        token: "--ring",
        tipo: "componente",
        fonte: {
          tipo: "grau",
          indice: 7,
          alfa: 1,
        },
        contra: null,
      },
      {
        token: "::selection/color",
        tipo: "texto",
        fonte: {
          tipo: "grau",
          indice: 10,
          alfa: 1,
        },
        contra: [
          {
            tipo: "grau",
            indice: 2,
            alfa: 1,
          },
        ],
      },
      {
        token: ":focus-visible/outline",
        tipo: "componente",
        fonte: {
          tipo: "grau",
          indice: 7,
          alfa: 1,
        },
        contra: null,
      },
    ],
    semanticas: [
      {
        nome: "success",
        hex: "#4caf50",
      },
      {
        nome: "warning",
        hex: "#e6a817",
      },
      {
        nome: "error",
        hex: "#ff2c2c",
      },
      {
        nome: "info",
        hex: "#045471",
      },
    ],
    neutros: [
      "#f8f9fa",
      "#f2f4f7",
      "#e6e9ef",
      "#d0d5dd",
      "#98a2b3",
      "#667085",
      "#495057",
      "#343a40",
      "#212529",
      "#16181b",
      "#0b0c0e",
    ],
    indices: {
      accent: 8,
      hover: 9,
      soft: 0,
    },
    alfaDoSoft: 1,
  },
  escuro: {
    nome: "escuro",
    base: [
      {
        chave: "--color-bg",
        hex: "#070707",
      },
      {
        chave: "--color-surface",
        hex: "#101010",
      },
      {
        chave: "--color-surface-elevated",
        hex: "#16161a",
      },
    ],
    tingidas: [
      {
        chave: "--color-accent-soft",
        fonte: {
          tipo: "literal",
          hex: "#0bf372",
          alfa: 0.1,
        },
      },
    ],
    papeis: [
      {
        token: "--color-accent",
        tipo: "componente",
        fonte: {
          tipo: "grau",
          indice: 4,
          alfa: 1,
        },
        contra: null,
      },
      {
        token: "--color-accent-fg",
        tipo: "texto",
        fonte: {
          tipo: "frenteCalculada",
          sobre: {
            tipo: "grau",
            indice: 4,
            alfa: 1,
          },
        },
        contra: [
          {
            tipo: "grau",
            indice: 4,
            alfa: 1,
          },
        ],
      },
      {
        token: "--color-accent-hover",
        tipo: "componente",
        fonte: {
          tipo: "grau",
          indice: 3,
          alfa: 1,
        },
        contra: null,
      },
      {
        token: "--ring",
        tipo: "componente",
        fonte: {
          tipo: "grau",
          indice: 4,
          alfa: 1,
        },
        contra: null,
      },
      {
        token: '[data-theme="dark"] ::selection/color',
        tipo: "texto",
        fonte: {
          tipo: "grau",
          indice: 0,
          alfa: 1,
        },
        contra: [
          {
            tipo: "grau",
            indice: 9,
            alfa: 1,
          },
        ],
      },
      {
        token: '[data-theme="dark"] :focus-visible/outline-color',
        tipo: "componente",
        fonte: {
          tipo: "grau",
          indice: 4,
          alfa: 1,
        },
        contra: null,
      },
    ],
    semanticas: [
      {
        nome: "success",
        hex: "#4caf50",
      },
      {
        nome: "warning",
        hex: "#e6b400",
      },
      {
        nome: "error",
        hex: "#ff5e5e",
      },
      {
        nome: "info",
        hex: "#5fb8db",
      },
    ],
    neutros: [
      "#e1e1e6",
      "#c4c4cc",
      "#a8a8b3",
      "#8a8a96",
      "#5c5c66",
      "#3a3a41",
      "#29292e",
      "#1c1c20",
      "#16161a",
      "#101010",
      "#070707",
    ],
    indices: {
      accent: 4,
      hover: 3,
      soft: null,
    },
    alfaDoSoft: 0.1,
  },
} as const;
