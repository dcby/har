import process from "./processors/google-music.ts";
import { expandGlob } from "https://deno.land/std@0.135.0/fs/mod.ts";


main();

async function main() {
    const paths: string[] = [];
    for await (const file of expandGlob("./har/*.har", { includeDirs: false })) {
        paths.push(file.path);
    }

    await process(paths);
}
