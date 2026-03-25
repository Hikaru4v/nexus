const BASE_URL = "https://anime.nexus";
const API_BASE = "https://api.anime.nexus";
const IMAGE_BASE = "https://anime.delivery";

async function getJson(url, extraHeaders = {}) {
    const response = await fetchv2(url, {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://anime.nexus/",
        "Origin": "https://anime.nexus",
        ...extraHeaders
    });
    return await response.json();
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

function uniqueBy(items, keyFn) {
    const seen = new Set();
    return items.filter(item => {
        const key = keyFn(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function makePosterUrl(item) {
    const resized = item?.poster?.resized;
    if (!resized) return "";

    const posterPath =
        resized["480x720"] ||
        resized["640x960"] ||
        resized["240x360"] ||
        resized["1560x2340"] ||
        "";

    if (!posterPath) return "";
    if (/^https?:\/\//i.test(posterPath)) return posterPath;

    return IMAGE_BASE + posterPath;
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
        const items = Array.isArray(json?.data) ? json.data : [];

        const results = items.map(item => {
            const id = item?.id || "";
            const slug = item?.slug || "";
            const title = item?.name || "Unknown";
            const alt = item?.name_alt || "";
            const image = makePosterUrl(item);
            const href = id && slug ? `/series/${id}/${slug}` : "";

            return {
                title: decodeHtmlEntities(title),
                image: image,
                href: href,
                link: href,
                url: href,
                alias: decodeHtmlEntities(alt)
            };
        }).filter(x => x.title && x.href);

        return JSON.stringify(uniqueBy(results, x => x.href));
    } catch (err) {
        console.error("ANIME NEXUS SEARCH ERROR:", err);
        return JSON.stringify([]);
    }
}
