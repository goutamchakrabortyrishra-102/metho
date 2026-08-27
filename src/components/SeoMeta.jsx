import { useEffect } from "react";

// Additive, isolated SEO helper: manages document.title, meta description/OG tags,
// and JSON-LD structured data script tags. Purely additive — does not alter any
// existing page state, routing, or the RuntimeMetaBindings component in App.js.
// Fails silently on any DOM error so it can never break page render.

const JSONLD_SCRIPT_ID_PREFIX = "seo-jsonld-";

function setMetaTag(key, keyValue, content) {
  try {
    if (!content) return;
    let node = document.head.querySelector(`meta[${key}="${keyValue}"]`);
    if (!node) {
      node = document.createElement("meta");
      node.setAttribute(key, keyValue);
      document.head.appendChild(node);
    }
    node.setAttribute("content", content);
  } catch {
    // Fail-safe: never let meta tag injection break the page.
  }
}

function setJsonLd(id, schema) {
  try {
    const elementId = `${JSONLD_SCRIPT_ID_PREFIX}${id}`;
    let node = document.getElementById(elementId);
    if (!schema) {
      if (node) node.remove();
      return;
    }
    if (!node) {
      node = document.createElement("script");
      node.type = "application/ld+json";
      node.id = elementId;
      document.head.appendChild(node);
    }
    node.textContent = JSON.stringify(schema);
  } catch {
    // Fail-safe: never let structured data injection break the page.
  }
}

/**
 * SeoMeta — optional, additive component. Drop it into any page without
 * touching that page's existing hooks/state. Unmount cleans up its own tags only.
 *
 * Props:
 *  - title: optional document title override
 *  - description: optional meta/OG description
 *  - schemas: optional array of JSON-LD schema objects (e.g. from seoSchema.js)
 *  - id: optional unique id to namespace JSON-LD script tags (defaults to "default")
 */
export default function SeoMeta({ title, description, schemas = [], id = "default" }) {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    try {
      if (title) document.title = String(title);
      if (description) {
        setMetaTag("name", "description", description);
        setMetaTag("property", "og:description", description);
      }
    } catch {
      // Fail-safe.
    }

    const validSchemas = Array.isArray(schemas) ? schemas.filter(Boolean) : [];
    validSchemas.forEach((schema, index) => setJsonLd(`${id}-${index}`, schema));

    return () => {
      validSchemas.forEach((_, index) => setJsonLd(`${id}-${index}`, null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, id, JSON.stringify(schemas)]);

  return null;
}
