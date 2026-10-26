import { filesRoutes } from "../modules/imports/store.js";
import { pageFileStoreRoutes } from "../modules/page-files/store-routes.js";
import { createService } from "./http.js";

/** Ordered route registration owned by the files process. */
export const filesModules = [filesRoutes, pageFileStoreRoutes];

export const buildFilesService = () => createService("files", filesModules);
