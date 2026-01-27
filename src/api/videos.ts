import { respondWithJSON } from "./json";
import { randomBytes } from "crypto";
import path from "node:path";
import { UserForbiddenError, BadRequestError } from "./errors";
import { getVideo } from "../db/videos";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { updateVideo, updateVideo } from "../db/videos";

const UPLOAD_LIMIT = 1 << 30;

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
    const { videoId } = req.params as { videoId?: string };
    if (!videoId) {
        throw new BadRequestError("Invalid video ID");
    }

    const token = getBearerToken(req.headers);
    const userID = validateJWT(token, cfg.jwtSecret);

    let mediaMetadata = getVideo(cfg.db, videoId);
    if (!mediaMetadata) {
        throw new BadRequestError("Video not found");
    }

    if (mediaMetadata.userID !== userID) {
        throw new UserForbiddenError("Access to resource denied");
    }

    const formData = await req.formData();
    const file = formData.get("video");
    if (!(file instanceof File)) {
        throw new BadRequestError("Video file is missing");
    }

    if (file.size > UPLOAD_LIMIT) {
        throw new BadRequestError("File size exceeds maximum updaload size");
    }

    const mediaType = file.type;
    if (mediaType !== "video/mp4") {
        throw new BadRequestError("Wrong file format");
    }

    const pathID = randomBytes(32).toString("base64url");
    let key = `${pathID}.mp4`;
    const tempFilePath = path.join("/tmp", key);
    
    await Bun.write(tempFilePath, file);

    const videoAspectRatio = await getVideoAspectRatio(tempFilePath);
    key = videoAspectRatio + "/" + key;

    await uploadVideoToS3(cfg, key, tempFilePath, mediaType);

    const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
    console.log(videoURL);
    mediaMetadata.videoURL = videoURL;

    await updateVideo(cfg.db, mediaMetadata);

    await Bun.file(tempFilePath).delete();

  return respondWithJSON(200, mediaMetadata);
}


export async function getVideoAspectRatio(filePath: string) {
    const proc = Bun.spawn([
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        filePath,
    ], {
        stderr: "pipe",
        stdout: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        throw new Error(await new Response(proc.stderr).text());
    }

    const stdoutText: string = await new Response(proc.stdout).text();
    const stdoutObj = JSON.parse(stdoutText);
    const [stream] = stdoutObj["streams"];
    const videoWidth = stream["width"];
    const videoHeight = stream["height"];
    
    const ratio = Math.floor((videoWidth / videoHeight), -1);

    switch (ratio) {
        case Math.floor((16 / 9), -1):
            return "landscape";

        case Math.floor((9 / 16), -1):
            return "portrait";

        default:
            return "other";
    }
}


export async function uploadVideoToS3(
  cfg: ApiConfig,
  key: string,
  processesFilePath: string,
  contentType: string,
) {
  const s3file = cfg.s3Client.file(key, { bucket: cfg.s3Bucket });
  const videoFile = Bun.file(processesFilePath);
  await s3file.write(videoFile, { type: contentType });
}
