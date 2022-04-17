import { parse as parseQueryString, ParsedUrlQuery } from "https://deno.land/std@0.135.0/node/querystring.ts";
import { parse as parseUrl } from "https://deno.land/std@0.135.0/node/url.ts";
import { resolve } from "https://deno.land/std@0.135.0/path/mod.ts";
import { writeAll } from "https://deno.land/std@0.135.0/streams/conversion.ts";
import { toUint8Array } from "https://denopkg.com/chiefbiiko/base64@master/mod.ts";
import { Har, PlayerContent, MusicPageType, PlaylistPanelVideoRenderer, PlaylistPanelVideoWrapperRenderer, QueueContent, QueueSongMetadata, SongMetadata, StreamingData, StreamingDataFormat } from "../types.ts";

export default async function process(paths: string[]) {
    // index data
    const dataIndex: Record<string, string[]> = {};
    const metaIndex: Record<string, PlaylistPanelVideoRenderer> = {};
    const numberIndex: Record<string, number> = {};
    const playerIndex: Record<string, StreamingData> = {};
    const playerList: string[] = [];

    // the very first step is to index potentially interesting data
    // more specifically this includes track metadata, track stream data
    // and player info that links metadata and stream data
    for (const path of paths) {
        const har: Har = JSON.parse(await Deno.readTextFile(path));

        for (const entry of har.log.entries) {
            const { url } = entry.request;
            if (url.startsWith("https://music.youtube.com/youtubei/v1/player")) {
                const { mimeType, text } = entry.response.content;

                if (mimeType.startsWith("application/json") && text.includes("\"videoDetails\"")) {
                    const content: PlayerContent = JSON.parse(text);
                    playerList.push(content.videoDetails.videoId);
                    playerIndex[content.videoDetails.videoId] = content.streamingData;
                }
            }
            else if (url.startsWith("https://music.youtube.com/youtubei/v1/music/get_queue")) {
                const { mimeType, text } = entry.response.content;
                if (mimeType.startsWith("application/json")) {
                    const content: QueueContent = JSON.parse(text);
                    for (const queueData of content.queueDatas) {
                        const playlistPanelVideoRenderer = "playlistPanelVideoRenderer" in queueData.content
                            ? queueData.content.playlistPanelVideoRenderer
                            : queueData.content.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer;
                        metaIndex[playlistPanelVideoRenderer.videoId] = playlistPanelVideoRenderer;
                    }
                }
            }
            else if (url.startsWith("https://music.youtube.com/youtubei/v1/next?")) {
                const { mimeType, text } = entry.response.content;
                if (mimeType.startsWith("application/json") && text.includes("\"playlistPanelVideoRenderer\"")) {
                    // deno-lint-ignore no-explicit-any
                    const content: any = JSON.parse(text);

                    const tabs = content.contents?.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer?.tabs;
                    if (Array.isArray(tabs)) {
                        for (const tab of tabs) {
                            const contents = tab.tabRenderer.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents;
                            if (Array.isArray(contents)) {
                                for (const content of contents) {
                                    let playlistPanelVideoRenderer: PlaylistPanelVideoRenderer | undefined;
                                    if (hasPlaylistPanelVideoRenderer(content)) {
                                        playlistPanelVideoRenderer = content.playlistPanelVideoRenderer;
                                    }
                                    else if (hasPlaylistPanelVideoWrapperRenderer(content)) {
                                        playlistPanelVideoRenderer = content.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer;
                                    }

                                    if (playlistPanelVideoRenderer) {
                                        metaIndex[playlistPanelVideoRenderer.videoId] = playlistPanelVideoRenderer;
                                    }
                                }
                            }
                        }
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

    for (const videoId of playerList) {
        const renderer = metaIndex[videoId];
        if (!renderer) {
            continue;
        }

        const meta = processPlaylistPanelVideoRenderer(renderer) as SongMetadata;
        const albumKey = `${meta.artists[0]}#${meta.album}`;
        numberIndex[albumKey] = numberIndex[albumKey] ?? 0;
        meta.number = ++numberIndex[albumKey];

        console.log(`${meta.artists[0]} - ${meta.year} - ${meta.album} - ${meta.title}`);

        const streamingData = playerIndex[videoId];
        const fileId = getFileId(streamingData.formats[0]);
        
        const file = await Deno.create(".temp");
        for (const chunk of dataIndex[fileId]) {
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

function getFileId(format: StreamingDataFormat) {
    let url: string;
    let p: ParsedUrlQuery;
    if ("signatureCipher" in format) {
        p = parseQueryString(format.signatureCipher);
        url = p.url as string;
    }
    else {
        url = format.url;
    }
    p = parseUrl(url, true, false).query as ParsedUrlQuery;

    return p.id as string;
}

function processPlaylistPanelVideoRenderer(playlistPanelVideoRenderer: PlaylistPanelVideoRenderer): QueueSongMetadata {
    if (playlistPanelVideoRenderer.title.runs.length !== 1) {
        throw new Error("!!!");
    }

    const albums: string[] = [];
    const artists: string[] = [];
    let year: number | undefined;

    const runs = playlistPanelVideoRenderer.longBylineText.runs;

    for (const run of runs) {
        switch (run.navigationEndpoint?.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType) {
            case MusicPageType.Album:
                albums.push(run.text);
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
        album: albums.length === 1 ? albums[0] : throwe(),
        artists: artists.length ? artists : throwe(),
        title: playlistPanelVideoRenderer.title.runs[0].text,
        // videoId: playlistPanelVideoRenderer.videoId,
        year: year ?? throwe(),
    };
}

function throwe(message?: string): never {
    throw new Error(message);
}

// deno-lint-ignore no-explicit-any
function hasPlaylistPanelVideoRenderer(value: any): value is { playlistPanelVideoRenderer: PlaylistPanelVideoRenderer } {
    return "playlistPanelVideoRenderer" in value;
}

// deno-lint-ignore no-explicit-any
function hasPlaylistPanelVideoWrapperRenderer(value: any): value is { playlistPanelVideoWrapperRenderer: PlaylistPanelVideoWrapperRenderer } {
    return "playlistPanelVideoWrapperRenderer" in value;
}
