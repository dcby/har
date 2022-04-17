import { parse as parseQueryString, ParsedUrlQuery } from "https://deno.land/std@0.135.0/node/querystring.ts";
import { parse as parseUrl } from "https://deno.land/std@0.135.0/node/url.ts";
import { resolve } from "https://deno.land/std@0.135.0/path/mod.ts";
import { writeAll } from "https://deno.land/std@0.135.0/streams/conversion.ts";
import { toUint8Array } from "https://denopkg.com/chiefbiiko/base64@master/mod.ts";
import { Har, MetadataContent, MusicPageType, PlaylistPanelVideoRenderer, QueueContent, QueueSongMetadata, SongMetadata } from "../types.ts";

export default async function process(paths: string[]) {
    // index data
    const dataIndex: Record<string, string[]> = {};
    const queueIndex: Record<string, QueueSongMetadata> = {};
    const metaIndex: SongMetadata[] = [];
    const numberIndex: Record<string, number> = {};

    for (const path of paths) {
        const har: Har = JSON.parse(await Deno.readTextFile(path));

        for (const entry of har.log.entries) {
            const { url } = entry.request;
            if (url.startsWith("https://music.youtube.com/youtubei/v1/player")) {
                const { mimeType, text } = entry.response.content;
    
                if (mimeType.startsWith("application/json") && text.includes("\"videoDetails\"")) {
                    // parse content
                    const content: MetadataContent = JSON.parse(text);
    
                    // locate temporary file id
                    let s = content.streamingData.formats[0].signatureCipher;
                    let p: ParsedUrlQuery = parseQueryString(s);
                    s = p.url as string;
                    const url = parseUrl(s, true, false);
                    p = url.query as ParsedUrlQuery;
    
                    const trackKey = `${content.videoDetails.author}#${content.microformat.microformatDataRenderer.tags[1]}`;
                    numberIndex[trackKey] = numberIndex[trackKey] ?? 0;
    
                    const meta: SongMetadata = {
                        album: content.microformat.microformatDataRenderer.tags[1],
                        artists: [ content.videoDetails.author ],
                        fileId: p.id as string,
                        number: ++numberIndex[trackKey],
                        title: content.videoDetails.title,
                        videoId: content.videoDetails.videoId,
                        year: new Date(content.microformat.microformatDataRenderer.publishDate).getFullYear(),
                    };
    
                    metaIndex.push(meta);
                }
            }
            else if (url.startsWith("https://music.youtube.com/youtubei/v1/music/get_queue")) {
                const { mimeType, text } = entry.response.content;
                if (mimeType.startsWith("application/json")) {
                    const content: QueueContent = JSON.parse(text);
                    for (const queueData of content.queueDatas) {
                        const data = processPlaylistPanelVideoRenderer(queueData.content.playlistPanelVideoRenderer ?? queueData.content.playlistPanelVideoWrapperRenderer?.primaryRenderer.playlistPanelVideoRenderer ?? throwe());
                        queueIndex[data.videoId] = data;
                    }
                }
            }
            else if (url.includes("/videoplayback?")) {
                const { mimeType, text } = entry.response.content;
    
                if (mimeType === "audio/mp4") {
                    const fileId = entry.request.queryString.find(e => e.name === "id")?.value;
    
                    // guard
                    if (!fileId) {
                        throw new Error("!!!");
                    }
        
                    const chunks = dataIndex[fileId] ?? (dataIndex[fileId] = []);
                    chunks.push(text);
                }
            }
        }
    }

    for (const meta of metaIndex) {
        // enrich meta from queue data
        const queueData = queueIndex[meta.videoId] ?? throwe();
        meta.album = queueData.album;
        meta.artists = queueData.artists;
        meta.year = queueData.year;

        console.log(`${meta.artists[0]} - ${meta.year} - ${meta.album} - ${meta.title}`);

        const file = await Deno.create(".temp");
        for (const chunk of dataIndex[meta.fileId]) {
            await writeAll(file, toUint8Array(chunk));
        }
        Deno.close(file.rid);

        // process file with ffmpeg 
        let path = resolve("out", meta.artists[0]);
        await Deno.mkdir(path, { recursive: true });
        path = resolve(path, `${meta.year} - ${meta.title}.m4a`);

        await Deno.run({ cmd: [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-i", ".temp",
            "-c", "copy",
            "-metadata", `album=${meta.album}`,
            "-metadata", `artist=${meta.artists.join("; ")}`,
            "-metadata", `date=${meta.year}`,
            "-metadata", `title=${meta.title}`,
            "-metadata", `track=${meta.number}`,
            "-movflags", "+faststart",
            "-y",
            path
        ] }).status();

        await Deno.remove(".temp");
    }
}

function processPlaylistPanelVideoRenderer(playlistPanelVideoRenderer: PlaylistPanelVideoRenderer) {
    let album: string | undefined;
    const artists: string[] = [];
    let year: number | undefined;

    for (const run of playlistPanelVideoRenderer.longBylineText.runs) {
        switch (run.navigationEndpoint?.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType) {
            case MusicPageType.Album:
                album = run.text;
                break;
            case MusicPageType.Artist:
                artists.push(run.text);
                break;
            case undefined:
                year = Number.parseInt(run.text) || undefined;
                break;
        }
    }

    return {
        album: album ?? throwe(),
        artists: artists.length ? artists : throwe(),
        videoId: playlistPanelVideoRenderer.videoId,
        year: year ?? throwe(),
    };
}

function throwe(message?: string): never {
    throw new Error(message);
}
