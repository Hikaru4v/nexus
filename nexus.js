async function searchResults(keyword) {
    const results = [];

    try {
        const response = await fetchv2("https://aniwatchtv.to/search?keyword=" + encodeURIComponent(keyword));
        const html = await response.text();

        const blocks = html.split('<div class="flw-item">').slice(1);

        for (const block of blocks) {
            const href = block.match(/<a href="([^"]+)"/);
            const image = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/);
            const title = block.match(/title="([^"]+?)"/);

            if (href && image && title) {
                results.push({
                    title: decodeHtmlEntities(title[1].trim()),
                    image: image[1].trim(),
                    href: href[1].trim()
                });
            }
        }

        return JSON.stringify(results);
    } catch (err) {
        return JSON.stringify([{
            title: "Error",
            image: "Error",
            href: "Error"
        }]);
    }
}

async function extractDetails(url) {
    try {
        const response = await fetchv2("https://aniwatchtv.to" + url);
        const html = await response.text();

        const descMatch = html.match(/<div class="film-description m-hide">[\s\S]*?<div class="text">\s*([\s\S]*?)\s*<\/div>/);
        const dateMatch = html.match(/<strong>Released:\s*<\/strong>\s*([^<\n]+)/);

        const description = descMatch ? descMatch[1].trim() : "N/A";
        const airdate = dateMatch ? dateMatch[1].trim() : "N/A";

        return JSON.stringify([{
            description: description,
            aliases: "N/A",
            airdate: airdate
        }]);

    } catch (err) {
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
        let watchUrl = url;
        if (!/\/watch\//.test(watchUrl)) {
            watchUrl = watchUrl.replace(/\/([^\/]+)$/, '/watch/$1');
        }

        const watchResp = await fetchv2("https://aniwatchtv.to" + watchUrl);
        const watchHtml = await watchResp.text();
        const idMatch = watchHtml.match(/<div[^>]+id="wrapper"[^>]+data-id="(\d+)"[^>]*>/);
        if (!idMatch) throw new Error("movie_id not found");
        const movieId = idMatch[1];

        const epListResp = await fetchv2(`https://aniwatchtv.to/ajax/v2/episode/list/${movieId}`);
        const epListJson = await epListResp.json();
        const epHtml = epListJson.html;

        const epRegex = /<a[^>]+class="ssl-item\s+ep-item"[^>]+data-number="(\d+)"[^>]+data-id="(\d+)"[^>]*>/g;
            let match;
            while ((match = epRegex.exec(epHtml)) !== null) {
                results.push({
                    href: match[2],
                    number: parseInt(match[1], 10)
                });
            }

        return JSON.stringify(results);
    } catch (err) {
        console.error(err);
        return JSON.stringify([{ id: "Error", href: "Error", number: "Error", title: "Error" }]);
    }
}

async function extractStreamUrl(ID) {
    try {
        const serversResp = await fetchv2(`https://aniwatchtv.to/ajax/v2/episode/servers?episodeId=${ID}`);
        const serversJson = await serversResp.json();
        const serversHtml = serversJson.html;
        
        const subServerMatch = serversHtml.match(/<div class="item server-item" data-type="sub" data-id="(\d+)"/);
        const dubServerMatch = serversHtml.match(/<div class="item server-item" data-type="dub" data-id="(\d+)"/);
        
        const subServerId = subServerMatch ? subServerMatch[1] : null;
        const dubServerId = dubServerMatch ? dubServerMatch[1] : null;
        
        if (!subServerId && !dubServerId) {
            return "https://error.org/";
        }
        
        const headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:146.0) Gecko/20100101 Firefox/146.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": "https://aniwatchtv.to/"
        };
        
        const processServer = async (serverId, title) => {
            try {
                const sourcesResp = await fetchv2(`https://aniwatchtv.to/ajax/v2/episode/sources?id=${serverId}`);
                const sourcesJson = await sourcesResp.json();
                const iframeUrl = sourcesJson.link;
                
                if (!iframeUrl) return null;
                
                const iframeResp = await fetchv2(iframeUrl, headers);
                const iframeHtml = await iframeResp.text();
                
                const videoTagMatch = iframeHtml.match(/data-id="([^"]+)"/);
                if (!videoTagMatch) return null;
                const fileId = videoTagMatch[1];
                
                const nonceMatch = iframeHtml.match(/\b[a-zA-Z0-9]{48}\b/) || 
                                  iframeHtml.match(/\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/);
                if (!nonceMatch) return null;
                
                const nonce = nonceMatch.length === 4 ? 
                             nonceMatch[1] + nonceMatch[2] + nonceMatch[3] : 
                             nonceMatch[0];
                
                const urlParts = iframeUrl.split('/');
                const protocol = iframeUrl.startsWith('https') ? 'https:' : 'http:';
                const hostname = urlParts[2];
                const defaultDomain = `${protocol}//${hostname}/`;
                
                const getSourcesUrl = `${defaultDomain}embed-2/v3/e-1/getSources?id=${fileId}&_k=${nonce}`;
                const getSourcesResp = await fetchv2(getSourcesUrl, headers);
                const getSourcesJson = await getSourcesResp.json();
                console.log(JSON.stringify(getSourcesJson));
                const videoUrl = getSourcesJson.sources?.[0]?.file || "";
                if (!videoUrl) return null;
                
                const streamHeaders = {
                    "Referer": defaultDomain,
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
                };
                
                return {
                    title: title,
                    streamUrl: videoUrl,
                    headers: streamHeaders,
                    sourcesData: getSourcesJson
                };
            } catch (e) {
                console.log(`${title} failed:`, e);
                return null;
            }
        };
        
        const serverPromises = [];
        if (subServerId) serverPromises.push(processServer(subServerId, "SUB"));
        if (dubServerId) serverPromises.push(processServer(dubServerId, "DUB"));
        
        const results = await Promise.all(serverPromises);
        const streams = results.filter(r => r !== null);
        
        if (streams.length === 0) {
            return "https://error.org/";
        }
        
        const englishTrack = streams[0].sourcesData.tracks?.find(t => t.kind === "captions" && t.label === "English");
        const subtitle = englishTrack ? englishTrack.file : "";
        
        const finalStreams = streams.map(s => ({
            title: s.title,
            streamUrl: s.streamUrl,
            headers: s.headers
        }));
        console.log(JSON.stringify({
            streams: finalStreams,
            subtitle: subtitle
        }));
        return JSON.stringify({
            streams: finalStreams,
            subtitles: subtitle
        });
    } catch (err) {
        console.error(err);
        return "https://error.org/";
    }
}

function decodeHtmlEntities(text) {
  if (!text) {
    return "";
  }
  return text
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}
