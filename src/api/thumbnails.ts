import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "node:path";


const MAX_UPLOAD_SIZE = 10 << 20;


type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};


export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
    const formData = await req.formData();
    const file = formData.get("thumbnail");
    if (!(file instanceof File)) {
        throw new BadRequestError("Thumbnail file is missing");
    }

    if (file.size > MAX_UPLOAD_SIZE) {
        throw new BadRequestError("File size exceeds maximum updaload size");
    }

    const mediaType = file.type;
    if (!(mediaType === "image/png" || mediaType === "image/jpeg")) {
        throw new BadRequestError("Wrong file format");
    }
    const mediaData = await file.arrayBuffer();
    const filePath = path.join(cfg.assetsRoot, `${videoId}.${mediaType}`);
    
    Bun.write(filePath, mediaData);

    let mediaMetadata = await getVideo(cfg.db, videoId);
    if (mediaMetadata.userID !== userID) {
        throw new UserForbiddenError("Access to resource denied");
    }
 
    mediaMetadata.thumbnailURL = `http://localhost:${cfg.port}/assets/${videoId}.${mediaType}`;

    await updateVideo(cfg.db, mediaMetadata);

  return respondWithJSON(200, mediaMetadata);
}
