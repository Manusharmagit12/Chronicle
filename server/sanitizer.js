/**
 * Chronicle HTML & CSS Sanitizer
 * Secures dynamic user-provided content cues against Cross-Site Scripting (XSS),
 * script injection, javascript: links, and dangerous embeds while preserving
 * standard safe HTML tags and styling.
 */

// List of allowed HTML tags
const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'small',
  'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'u', 'ul'
]);

// List of allowed attributes (global and tag-specific)
const ALLOWED_ATTRS = new Set([
  'align', 'alt', 'class', 'colspan', 'height', 'href', 'id', 'loading',
  'rel', 'rowspan', 'src', 'style', 'target', 'title', 'width'
]);

/**
 * Sanitizes HTML markup by:
 * 1. Removing <script>, <style> (in body), <object>, <embed>, <iframe>, <form>, etc.
 * 2. Removing inline event handlers (onclick, onload, onerror, etc.)
 * 3. Blocking javascript: and data: protocols in URLs
 * 4. Stripping disallowed tags while keeping allowed tags intact
 */
export function sanitizeHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let html = rawHtml;

  // 1. Remove dangerous blocks and their contents completely
  const dangerousBlockTags = ['script', 'iframe', 'object', 'embed', 'applet', 'meta', 'link', 'base', 'form'];
  for (const tag of dangerousBlockTags) {
    const blockRegex = new RegExp(`<\\s*${tag}[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`, 'gi');
    html = html.replace(blockRegex, '');
    // Also remove any self-closing or unclosed single tags
    const singleTagRegex = new RegExp(`<\\s*\\/?\\s*${tag}[^>]*>`, 'gi');
    html = html.replace(singleTagRegex, '');
  }

  // 2. Strip inline event handlers (e.g. onclick="...", onload=..., onmouseover=...)
  html = html.replace(/\s+on[a-z0-9_-]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');

  // 3. Neutralize dangerous URL protocols (javascript:, data:text/html, vbscript:)
  html = html.replace(
    /(href|src|action|formaction)\s*=\s*(['"]?)\s*(?:javascript|vbscript|data\s*:\s*text\/html):[^'">\s]*\2/gi,
    '$1="#"'
  );

  // 4. Strip any disallowed tags while keeping allowed tags intact
  html = html.replace(/<\/?([a-zA-Z0-9_-]+)([^>]*)>/g, (match, tagName, attrsStr) => {
    const lowerTag = tagName.toLowerCase();
    const isClosing = match.startsWith('</');

    if (!ALLOWED_TAGS.has(lowerTag)) {
      // Disallowed tag - remove tag wrapper
      return '';
    }

    if (isClosing) {
      return `</${lowerTag}>`;
    }

    // Filter attributes for allowed tag
    let sanitizedAttrs = '';
    const attrRegex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attrMatch;

    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      let attrVal = attrMatch[2] !== undefined ? attrMatch[2] : (attrMatch[3] !== undefined ? attrMatch[3] : attrMatch[4]);

      // Block any event handlers that might have slipped through
      if (attrName.startsWith('on')) continue;

      if (!ALLOWED_ATTRS.has(attrName)) continue;

      if (attrVal !== undefined) {
        // Sanitize href / src against javascript: or data:
        if ((attrName === 'href' || attrName === 'src') && /(?:javascript|vbscript|data\s*:)/i.test(attrVal)) {
          attrVal = '#';
        }

        // Sanitize inline style: prevent expression() or url(javascript:...)
        if (attrName === 'style') {
          attrVal = sanitizeInlineStyle(attrVal);
        }

        sanitizedAttrs += ` ${attrName}="${escapeAttr(attrVal)}"`;
      } else {
        sanitizedAttrs += ` ${attrName}`;
      }
    }

    return `<${lowerTag}${sanitizedAttrs}>`;
  });

  return html.trim();
}

/**
 * Sanitizes CSS strings to prevent CSS injection, expressions, and javascript URLs
 */
export function sanitizeCss(rawCss) {
  if (!rawCss || typeof rawCss !== 'string') return '';

  let css = rawCss;
  // Remove CSS expressions (IE legacy exploit)
  css = css.replace(/expression\s*\([^)]*\)/gi, '');
  // Remove javascript: in url()
  css = css.replace(/url\s*\(\s*(['"]?)\s*javascript:[^)]*\1\s*\)/gi, 'none');
  // Remove @import
  css = css.replace(/@import\s+[^;]+;/gi, '');
  // Remove dangerous behavior bindings
  css = css.replace(/-moz-binding\s*:[^;]+;/gi, '');
  css = css.replace(/behavior\s*:[^;]+;/gi, '');

  return css.trim();
}

function sanitizeInlineStyle(styleVal) {
  if (!styleVal) return '';
  return styleVal
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*(['"]?)\s*javascript:[^)]*\1\s*\)/gi, 'none')
    .replace(/behavior\s*:[^;]+;?/gi, '');
}

function escapeAttr(val) {
  if (!val) return '';
  return val.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
