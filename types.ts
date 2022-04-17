// har types
export interface Har {
    log: HarLog;
}

export interface HarLog {
    entries: HarLogEntry[];
}

export interface HarLogEntry {
    request: HarRequest;
    response: HarResponse;
}

export interface HarRequest {
    queryString: { name: string; value: string; }[];
    url: string;
}

export interface HarResponse {
    content: HarResponseContent;
}

export interface HarResponseContent {
    mimeType: string;
    text: string;
}


// google types
export interface PlayerContent {
    microformat: Microformat;
    streamingData: StreamingData;
    videoDetails: VideoDetails;
}

export interface VideoDetails {
    author: string;
    title: string;
    videoId: string;
}

export interface Microformat {
    microformatDataRenderer: MicroformatDataRenderer;
}

export interface MicroformatDataRenderer {
    publishDate: string;
    tags: string[];
}

export interface StreamingData {
    formats: StreamingDataFormat[];
}

export type StreamingDataFormat = Record<never, never> & SignatureCipherOrUrl;

export type SignatureCipherOrUrl = { signatureCipher: string; } | { url: string };

export interface QueueContent {
    queueDatas: {
        content: { playlistPanelVideoRenderer: PlaylistPanelVideoRenderer; }
            | { playlistPanelVideoWrapperRenderer: PlaylistPanelVideoWrapperRenderer; };
    }[];
}

export interface PlaylistPanelVideoRenderer {
    longBylineText: {
        runs: Run[];
    };
    title: { runs: Run[]; };
    videoId: string;
}

export interface PlaylistPanelVideoWrapperRenderer {
    primaryRenderer: {
        playlistPanelVideoRenderer: PlaylistPanelVideoRenderer
    };
}

export interface Run {
    navigationEndpoint?: {
        browseEndpoint: {
            browseEndpointContextSupportedConfigs: {
                browseEndpointContextMusicConfig: {
                    pageType: MusicPageType;
                };
            };
            browseId: string;
        };
    };
    text: string;
}

export enum MusicPageType {
    Album = "MUSIC_PAGE_TYPE_ALBUM",
    Artist = "MUSIC_PAGE_TYPE_ARTIST",
}


// app types
export interface SongMetadata extends QueueSongMetadata {
    number: number;
}

export interface QueueSongMetadata {
    album: string;
    artists: string[];
    title: string;
    year: number;
}
