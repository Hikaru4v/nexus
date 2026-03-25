const BASE_URL = "https://anime.nexus";

async function getHtml(url, headers = {}) {
    const response = await fetchv2(url, headers);
    return await response.text();
}

function absUrl(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return BASE_URL + (url.startsWith("/") ? url : "/" + url);
}

function parseHtml(html) {
    return new DOMParser().parseFromString(html, "text/html");
}

function text(el) {
    return el?.textContent?.trim?.() || "";
}

function attr(el, name) {
    return el?.getAttribute?.(name)?.trim?.() || "";
}

function decodeHtmlEntities(str) {
    if (!str) return "";
    return str
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
}

function bestImageFromNode(node) {
    if (!node) return "";
    const img = node.matches?.("img") ? node : node.querySelector?.("img");
    if (!img) return "";

    const src = attr(img, "src");
    const dataSrc = attr(img, "data-src");
    const srcset = attr(img, "srcset");

    if (src) return src;
    if (dataSrc) return dataSrc;

    if (srcset) {
        const first = srcset
            .split(",")
            .map(x => x.trim().split(/\s+/)[0])
            .find(Boolean);
        if (first) return first;
    }

    return "";
}

function uniqueBy(items, keyFn) {
    const seen = new Set();
    return items.filter(item => {
        const key = keyFn(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function searchResults(keyword) {
    try {
        const url =
            `${API_BASE}/api/anime/shows` +
            `?search=${encodeURIComponent(keyword)}` +
            `&sortBy=${encodeURIComponent("name asc")}` +
            `&page=1` +
            `&includes[]=poster` +
            `&includes[]=genres` +
            `&hasVideos=1`;

        const json = await getJson(url);

        const rawItems = json?.data || [];

        const results = rawItems.map(item => {
            const slug = item?.slug || "";
            const id = item?.id || "";
            const name = item?.name || item?.title || "Unknown";
            const altName = item?.name_alt || "";

            const poster =
                item?.poster?.resized?.["240x360"] ||
                item?.poster?.resized?.["480x720"] ||
                item?.poster?.resized?.["640x960"] ||
                item?.poster?.resized?.["1560x2340"] ||
                "";

            const href = id && slug
                ? `/series/${id}/${slug}`
                : slug
                    ? `/series/${slug}`
                    : "";

            return {
                title: decodeHtmlEntities(name),
                image: absUrl(poster),
                href: absUrl(href),
                alias: decodeHtmlEntities(altName)
            };
        }).filter(x => x.href && x.title && x.image);

        return JSON.stringify(uniqueBy(results, x => x.href));
    } catch (err) {
        console.error("searchResults error:", err);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const fullUrl = absUrl(url);
        const html = await getHtml(fullUrl);
        const doc = parseHtml(html);

        const title =
            attr(doc.querySelector('meta[property="og:title"]'), "content") ||
            attr(doc.querySelector('meta[name="twitter:title"]'), "content") ||
            attr(doc.querySelector("a[title]"), "title") ||
            text(doc.querySelector("h1")) ||
            "N/A";

        const description =
            attr(doc.querySelector('meta[property="og:description"]'), "content") ||
            attr(doc.querySelector('meta[name="description"]'), "content") ||
            text(doc.querySelector(".film-description .text")) ||
            [...doc.querySelectorAll("p")]
                .map(p => text(p))
                .find(t => t.length > 80) ||
            "N/A";

        let airdate = "N/A";
        const yearNode = [...doc.querySelectorAll("span, div")]
            .map(el => text(el))
            .find(t => /^\d{4}$/.test(t));
        if (yearNode) airdate = yearNode;

        let aliases = "N/A";

        try {
            const jsonLdNodes = [...doc.querySelectorAll('script[type="application/ld+json"]')];
            for (const node of jsonLdNodes) {
                const raw = text(node);
                if (!raw) continue;
                const data = JSON.parse(raw);

                if (data.alternateName) aliases = data.alternateName;
                if (data.datePublished && airdate === "N/A") airdate = data.datePublished;
            }
        } catch (_) {}

        return JSON.stringify([{
            description: decodeHtmlEntities(description),
            aliases: decodeHtmlEntities(aliases),
            airdate: decodeHtmlEntities(airdate),
            title: decodeHtmlEntities(title)
        }]);
    } catch (err) {
        console.error(err);
        return JSON.stringify([{
            description: "Error",
            aliases: "Error",
            airdate: "Error",
            title: "Error"
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        const fullUrl = absUrl(url);
        const html = await getHtml(fullUrl);
        const doc = parseHtml(html);

        const links = [...doc.querySelectorAll('a[href*="/watch/"], a[href*="/episode/"]')];
        let results = links.map((a, index) => {
            const href = attr(a, "href");
            const rawText = text(a);

            let number = null;

            const textMatch = rawText.match(/episode\s*(\d+)/i);
            const hrefMatch = href.match(/(?:episode|ep)[-\/]?(\d+)/i);
            const endMatch = href.match(/\/(\d+)(?:\/)?$/);

            if (textMatch) number = parseInt(textMatch[1], 10);
            else if (hrefMatch) number = parseInt(hrefMatch[1], 10);
            else if (endMatch) number = parseInt(endMatch[1], 10);
            else number = index + 1;

            return {
                href,
                number
            };
        }).filter(x => x.href);

        results = uniqueBy(results, x => x.href).sort((a, b) => a.number - b.number);

        if (!results.length) {
            return JSON.stringify([]);
        }

        return JSON.stringify(results);
    } catch (err) {
        console.error(err);
        return JSON.stringify([{
            href: "Error",
            number: "Error"
        }]);
    }
}

async function extractStreamUrl(url) {
    try {
        const fullUrl = absUrl(url);
        const html = await getHtml(fullUrl, {
            "User-Agent": "Mozilla/5.0",
            "Referer": BASE_URL + "/"
        });

        const doc = parseHtml(html);
        const streams = [];
        let subtitles = "";

        // Direct <video> sources
        const directSources = [...doc.querySelectorAll("video source[src]")];
        for (const source of directSources) {
            const streamUrl = attr(source, "src");
            if (!streamUrl) continue;

            streams.push({
                title: "STREAM",
                streamUrl,
                headers: {
                    "Referer": fullUrl,
                    "User-Agent": "Mozilla/5.0"
                }
            });
        }

        // Subtitle tracks
        const trackEls = [...doc.querySelectorAll('track[kind="captions"], track[kind="subtitles"]')];
        const englishTrack = trackEls.find(t =>
            /english/i.test(attr(t, "label")) || /en/i.test(attr(t, "srclang"))
        );
        if (englishTrack) {
            subtitles = attr(englishTrack, "src");
        } else if (trackEls[0]) {
            subtitles = attr(trackEls[0], "src");
        }

        // Iframe fallback
        if (!streams.length) {
            const iframe = doc.querySelector("iframe[src]");
            if (iframe) {
                const iframeUrl = absUrl(attr(iframe, "src"));
                const iframeHtml = await getHtml(iframeUrl, {
                    "User-Agent": "Mozilla/5.0",
                    "Referer": fullUrl
                });

                const matches = [
                    ...iframeHtml.matchAll(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/g),
                    ...iframeHtml.matchAll(/https?:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/g)
                ].map(m => m[0]);

                for (const match of [...new Set(matches)]) {
                    streams.push({
                        title: "STREAM",
                        streamUrl: match,
                        headers: {
                            "Referer": iframeUrl,
                            "User-Agent": "Mozilla/5.0"
                        }
                    });
                }

                if (!subtitles) {
                    const subMatch = iframeHtml.match(/https?:\/\/[^"'\\\s]+\.(vtt|srt)[^"'\\\s]*/i);
                    if (subMatch) subtitles = subMatch[0];
                }
            }
        }

        // Raw HTML fallback
        if (!streams.length) {
            const matches = [
                ...html.matchAll(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/g),
                ...html.matchAll(/https?:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/g)
            ].map(m => m[0]);

            for (const match of [...new Set(matches)]) {
                streams.push({
                    title: "STREAM",
                    streamUrl: match,
                    headers: {
                        "Referer": fullUrl,
                        "User-Agent": "Mozilla/5.0"
                    }
                });
            }
        }

        if (!streams.length) {
            return "https://error.org/";
        }

        return JSON.stringify({
            streams,
            subtitles
        });
    } catch (err) {
        console.error(err);
        return "https://error.org/";
    }
}
