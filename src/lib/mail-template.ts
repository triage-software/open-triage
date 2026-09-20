// Imported only by the server-side MIME composer, never by the team/editor UI.
import mjml2html from "mjml";
import type { EmployeeSignature } from "./types";
import { companyLegal } from "./signatures";
import { convert } from "html-to-text";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function contactLink(href: string, label: string) {
  return `<a href="${escapeHtml(encodeURI(href))}" style="color:#253b56;text-decoration:none;word-break:break-word">${escapeHtml(label)}</a>`;
}

export function defaultSignatureMjml(signature: EmployeeSignature): string {
  return `<mjml lang="pl">
    <mj-head>
      <mj-attributes>
        <mj-all font-family="Arial, Helvetica, sans-serif" />
        <mj-text padding="0" color="#253b56" font-size="14px" line-height="1.55" />
        <mj-section padding="0" text-align="left" />
        <mj-column padding="0" vertical-align="top" />
      </mj-attributes>
      <mj-style inline="inline">.mail-section { margin: 0 !important; }</mj-style>
    </mj-head>
    <mj-body width="560px" background-color="#ffffff">
      <mj-section css-class="mail-section">
        <mj-column>
          <mj-text color="#666666" padding="0 0 14px">Pozdrawiam,</mj-text>
        </mj-column>
      </mj-section>
      <mj-section css-class="mail-section">
        <mj-column width="32%" padding="5px 20px 18px 0">
          <mj-text color="#18385c" font-size="20px" font-weight="700" line-height="1.25" letter-spacing="0.5px">${escapeHtml(signature.company)}</mj-text>
          <mj-text color="#777777" font-size="10px" padding="14px 0 0">CUSTOMER<br />SUPPORT</mj-text>
        </mj-column>
        <mj-column width="68%" border-left="2px solid #18385c" padding="0 0 0 24px">
          <mj-text color="#18385c" font-size="22px" font-weight="700" line-height="1.2">${escapeHtml(signature.name)}</mj-text>
          <mj-text color="#6b6f76" padding="6px 0 20px">${escapeHtml(signature.title)}</mj-text>
          ${signature.phone ? `<mj-text font-size="12px" padding="0 0 7px">☎&nbsp; ${contactLink(`tel:${signature.phone.replace(/\s/g, "")}`, signature.phone)}</mj-text>` : ""}
          <mj-text font-size="12px" padding="0 0 7px">✉&nbsp; ${contactLink(`mailto:${signature.email}`, signature.email)}</mj-text>
          <mj-text font-size="12px">🌐&nbsp; ${contactLink(`https://${signature.website}`, signature.website)}</mj-text>
        </mj-column>
      </mj-section>
      <mj-section css-class="mail-section" padding="14px 0 0">
        <mj-column>
          <mj-divider border-width="1px" border-color="#dddddd" padding="0 0 10px" />
          <mj-text color="#898989" font-size="9px" line-height="1.5">${escapeHtml(companyLegal)}</mj-text>
        </mj-column>
      </mj-section>
    </mj-body>
  </mjml>`;
}

async function compile(source: string) {
  const { html } = await mjml2html(source, {
    validationLevel: "strict",
    ignoreIncludes: true,
    fonts: {},
  });
  return html;
}

export async function compileSignatureMjml(source: string) {
  if (source.length > 50_000 || !source.trim()) throw new Error("Podpis musi zawierać MJML i mieć do 50 000 znaków.");
  if ((source.match(/<mj-body(?:\s|>)/g) ?? []).length !== 1)
    throw new Error("Podpis musi zawierać dokładnie jeden element mj-body.");
  if (/<\s*(?:mj-include|script|iframe|object|embed|form|base|link)\b|\bon[a-z]+\s*=|(?:javascript|vbscript)\s*:|@import|url\s*\(/i.test(source))
    throw new Error("Podpis nie może zawierać skryptów, osadzonych stron ani importów plików i CSS.");
  try {
    const html = await compile(source);
    const text = convert(html, { wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }, { selector: "img", format: "skip" }] });
    if (!text.trim()) throw new Error("EMPTY_SIGNATURE");
    return { mjml: source, html, text };
  } catch (error) {
    const lines = (error as { errors?: { line?: number; message?: string }[] }).errors;
    const details = lines?.slice(0, 4).map((item) => `Wiersz ${item.line ?? "?"}: ${item.message ?? "błąd składni"}`).join("\n");
    throw new Error(details ? `Nieprawidłowy MJML. ${details}` : "Nieprawidłowy MJML lub pusty podpis. Sprawdź składnię szablonu.");
  }
}

export async function messageHtml(body: string, signature: EmployeeSignature): Promise<string> {
  const source = signature.custom?.mjml ?? defaultSignatureMjml(signature);
  // The reply is inserted as escaped text; the full MJML document retains its
  // responsive CSS and Outlook conditionals in the HTML MIME part.
  const reply = `<mj-section padding="0 0 24px" css-class="mail-section"><mj-column><mj-text font-family="Arial, Helvetica, sans-serif" font-size="14px" color="#222222" line-height="1.55" padding="0">${escapeHtml(body).replace(/\r\n|\r|\n/g, "<br />")}</mj-text></mj-column></mj-section>`;
  return compile(source.replace(/<mj-body\b[^>]*>/, (opening) => opening + reply));
}
