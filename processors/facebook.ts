import { resolve } from "https://deno.land/std@0.135.0/path/mod.ts";
import { writeAll } from "https://deno.land/std@0.135.0/streams/conversion.ts";
import { toUint8Array } from "https://denopkg.com/chiefbiiko/base64@master/mod.ts";
import { Har } from "../types.ts";

export default async function process(paths: string[]) {
    // index data
    const dataIndex: Record<string, string[]> = {};

    for (const path of paths) {
        const har: Har = JSON.parse(await Deno.readTextFile(path));

        for (const entry of har.log.entries) {
            const { url } = entry.request;

            if (url.includes("/1364378750655873.mp4?")) {
                const { mimeType, text } = entry.response.content;
    
                if (mimeType === "video/mp4") {
                    const chunks = dataIndex["video"] ?? (dataIndex["video"] = []);
                    chunks.push(text);
                }
            }
        }
    }

    const file = await Deno.create(".temp");
    for (const chunk of dataIndex["video"]) {
        await writeAll(file, toUint8Array(chunk));
    }
    Deno.close(file.rid);

    // process file with ffmpeg 
    const path = resolve("./1364378750655873.mp4");

    await Deno.run({ cmd: [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-i", ".temp",
        "-c", "copy",
        "-movflags", "+faststart",
        "-y",
        path
    ] }).status();

    await Deno.remove(".temp");
}
