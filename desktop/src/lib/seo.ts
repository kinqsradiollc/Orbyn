/**
 * What search engines and link previews read about the current page: its
 * title, a description, the address to credit, and whether to index it.
 * index.html carries the homepage's values for crawlers that run no script;
 * this keeps them right as the app moves between pages and hosts.
 */
export type PageMeta = {
  title: string;
  description: string;
  /** Only the homepage is for search results; everything else needs a sign-in or is private. */
  index: boolean;
};

function tag<T extends HTMLElement>(selector: string, create: () => T) {
  let el = document.head.querySelector<T>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  return el;
}

const named = (name: string) =>
  tag(`meta[name="${name}"]`, () => {
    const m = document.createElement("meta");
    m.name = name;
    return m;
  });

const property = (prop: string) =>
  tag(`meta[property="${prop}"]`, () => {
    const m = document.createElement("meta");
    m.setAttribute("property", prop);
    return m;
  });

export function setPageMeta({ title, description, index }: PageMeta) {
  document.title = title;
  // The canonical address is this page at the host it's served from, so a
  // self-hosted Orbyn never credits orbyn.dev.
  const url = location.origin + location.pathname;
  named("description").content = description;
  named("robots").content = index ? "index, follow" : "noindex, nofollow";
  tag('link[rel="canonical"]', () => {
    const l = document.createElement("link");
    l.rel = "canonical";
    return l;
  }).setAttribute("href", url);
  property("og:title").content = title;
  property("og:description").content = description;
  property("og:url").content = url;
  property("og:image").content = `${location.origin}/og-image.png`;
  named("twitter:title").content = title;
  named("twitter:description").content = description;
  named("twitter:image").content = `${location.origin}/og-image.png`;
}
