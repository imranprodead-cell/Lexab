/**
 * Client-side document export helpers.
 *
 * DOCX: emits a Word-compatible HTML document (opens natively in MS Word /
 * Google Docs) with the redlines applied — no server needed. A production
 * backend can later stream a true .docx binary; the call site stays the same.
 * PDF: opens the print dialog scoped to the rendered document.
 */
import type { AnalysisResult } from '@/types/domain';

function resolveText(analysis: AnalysisResult): string {
  const parts: string[] = [];
  for (const block of analysis.document) {
    if (block.type === 'heading') {
      parts.push(`<h3>${block.text ?? ''}</h3>`);
      continue;
    }
    let paragraph = '';
    for (const seg of block.segments ?? []) {
      if (typeof seg === 'string') {
        paragraph += seg;
      } else {
        const rl = analysis.redlines.find((r) => r.id === seg.redlineId);
        if (!rl) continue;
        // Accepted → insertion text; rejected → original; pending → accept suggestion.
        paragraph += rl.status === 'rejected' ? rl.delText : rl.insText;
      }
    }
    parts.push(`<p>${paragraph}</p>`);
  }
  return parts.join('\n');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Download the reviewed contract as a Word-openable .doc file. */
export function exportDocx(analysis: AnalysisResult) {
  const body = resolveText(analysis);
  const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${analysis.fileName}</title>
<style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.6;} h3{font-size:13pt;}</style></head>
<body><h2>Contract of Employment</h2>${body}</body></html>`;
  const blob = new Blob([html], { type: 'application/msword' });
  const name = analysis.fileName.replace(/\.[^.]+$/, '') + '.doc';
  triggerDownload(blob, name);
}

/** Open a print-ready window (user chooses “Save as PDF”). */
export function exportPdf(analysis: AnalysisResult) {
  const body = resolveText(analysis);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${analysis.fileName}</title>
<style>@page{margin:2cm;} body{font-family:Georgia,serif;font-size:12pt;line-height:1.7;color:#111;} h2{text-align:center;} h3{margin-top:1.4em;}</style>
</head><body><h2>Contract of Employment</h2>${body}
<script>window.onload=function(){window.print();}</script></body></html>`);
  win.document.close();
}
