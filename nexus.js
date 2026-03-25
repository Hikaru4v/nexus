// ==================== ANIME.NEXUS SCRAPER ====================

async function searchResults(keyword) {
    const results = [];
    try {
        const response = await fetchv2(
            `https://anime.nexus/api/search?q=${encodeURIComponent(keyword)}&limit=20`
        );
        
        const data = await response.json();

        if (!data.results || !Array.isArray(data.results)) {
            return JSON.stringify([{ title: "No results found", image: "", href: "" }]);
        }

        for (const item of data.results) {
            results.push({
                title: item.title?.english || item.title?.romaji || item.title?.native || "Unknown",
                image: item.image || item.coverImage || "",
                href: `/anime/${item.slug || item.id}`   // relative URL
            });
        }

        return JSON.stringify(results);
    } catch (err) {
        console.error("Search error on anime.nexus:", err);
        return JSON.stringify([{ title: "Error", image: "", href: "" }]);
    }
}

async function extractDetails(url) {
    try {
        // url is like "/anime/some-slug"
        const slug = url.replace(/^\/anime\//, "");
        
        const response = await fetchv2(`https://anime.nexus/api/anime/${slug}`);
        const data = await response.json();

        return JSON.stringify([{
            description: data.description || data.synopsis || "N/A",
            aliases: data.synonyms ? data.synonyms.join(", ") : "N/A",
            airdate: data.aired?.from || data.releaseDate || "N/A"
        }]);
    } catch (err) {
        console.error("Details error:", err);
        return JSON.stringify([{
            description: "Error",
            aliases: "Error",
            airdate: "Error"
        }]);
    }
}

async function extractEpisodes(url) {
    const results = [];
    try {
        const slug = url.replace(/^\/anime\//, "").replace(/\/watch.*/, "");
        
        // Get anime info with episodes
        const resp = await fetchv2(`https://anime.nexus/api/anime/${slug}`);
        const animeData = await resp.json();

        if (!animeData.episodes || !Array.isArray(animeData.episodes)) {
            return JSON.stringify([{ href: "Error", number: 0 }]);
        }

        for (const ep of animeData.episodes) {
            results.push({
                href: ep.id.toString(),           // episode ID used for streaming
                number: parseInt(ep.number || ep.episodeNumber, 10),
                title: ep.title || `Episode ${ep.number}`
            });
        }

        // Sort by episode number just in case
        results.sort((a, b) => a.number - b.number);

        return JSON.stringify(results.length ? results : [{ href: "Error", number: 0 }]);
    } catch (err) {
        console.error("Episodes error:", err);
        return JSON.stringify([{ href: "Error", number: 0 }]);
    }
}

async function extractStreamUrl(episodeId) {
    try {
        // Get streaming sources for the episode
        const resp = await fetchv2(`https://anime.nexus/api/episode/${episodeId}/sources`);
        const data = await resp.json();

        const streams = [];

        // Usually has "sub" and sometimes "dub"
        if (data.sources && Array.isArray(data.sources)) {
            for (const source of data.sources) {
                if (source.file || source.url) {
                    streams.push({
                        title: source.type?.toUpperCase() || "SUB",
                        streamUrl: source.file || source.url,
                        headers: {
                            "Referer": "https://anime.nexus/",
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                        }
                    });
                }
            }
        }

        // Extract English subtitles if available
        let subtitle = "";
        if (data.tracks && Array.isArray(data.tracks)) {
            const engTrack = data.tracks.find(t => 
                (t.kind === "captions" || t.kind === "subtitles") &&
                (t.label || "").toLowerCase().includes("english")
            );
            if (engTrack && engTrack.file) {
                subtitle = engTrack.file;
            }
        }

        if (streams.length === 0) {
            return "https://error.org/";
        }

        return JSON.stringify({
            streams: streams,
            subtitles: subtitle
        });

    } catch (err) {
        console.error("Stream extraction error:", err);
        return "https://error.org/";
    }
}

// Keep your existing helper
function decodeHtmlEntities(text) {
    if (!text) return "";
    return text
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
}
