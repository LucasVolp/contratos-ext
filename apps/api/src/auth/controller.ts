import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Data } from "../domain";
import { presentViewer, requireManager, Viewer } from "./access";
import { DirectoryService } from "./directory";
import { PublicUnits } from "./public-units";
import { CurrentViewer, Public, sessionToken } from "./guard";
import { AuthService, SESSION_COOKIE, sessionTtlMs } from "./service";
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.SESSION_COOKIE_SECURE === "true",
  path: "/",
});
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Public() @Post("login") @HttpCode(200) async login(
    @Body() body: Data,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { token, viewer } = await this.auth.login(body);
    response.cookie(SESSION_COOKIE, token, {
      ...cookieOptions(),
      maxAge: sessionTtlMs(),
    });
    return presentViewer(viewer);
  }
  @Public() @Post("logout") @HttpCode(200) async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.clearCookie(SESSION_COOKIE, cookieOptions());
    return this.auth.logout(sessionToken(request));
  }
  @Get("me") me(@CurrentViewer() viewer: Viewer) {
    return presentViewer(viewer);
  }
  @Post("password") @HttpCode(200) password(
    @CurrentViewer() viewer: Viewer,
    @Body() body: Data,
  ) {
    return this.auth.changePassword(viewer, body);
  }
  @Post("impersonate/:userId") @HttpCode(200) impersonate(
    @CurrentViewer() viewer: Viewer,
    @Param("userId", new ParseUUIDPipe()) userId: string,
  ) {
    return this.auth.impersonate(viewer, userId);
  }
  @Post("impersonation/stop") @HttpCode(200) stop(
    @CurrentViewer() viewer: Viewer,
  ) {
    return this.auth.stopImpersonation(viewer);
  }
}
@Controller("users")
export class UsersController {
  constructor(
    @Inject(DirectoryService) private readonly directory: DirectoryService,
  ) {}
  @Get() list(@CurrentViewer() viewer: Viewer) {
    requireManager(viewer);
    return this.directory.users();
  }
  @Post() create(@CurrentViewer() viewer: Viewer, @Body() body: Data) {
    requireManager(viewer);
    return this.directory.createUser(body);
  }
  @Put(":id") update(
    @CurrentViewer() viewer: Viewer,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Data,
  ) {
    requireManager(viewer);
    return this.directory.updateUser(viewer, id, body);
  }
}
@Controller("institutions")
export class InstitutionsController {
  constructor(
    @Inject(DirectoryService) private readonly directory: DirectoryService,
    @Inject(PublicUnits) private readonly publicUnits: PublicUnits,
  ) {}
  @Get() list(@CurrentViewer() viewer: Viewer) {
    return this.directory.institutions(viewer);
  }
  @Get("public") search(@CurrentViewer() viewer: Viewer, @Query() query: Data) {
    requireManager(viewer);
    return this.publicUnits.search(query);
  }
  @Post("import") import(@CurrentViewer() viewer: Viewer, @Body() body: Data) {
    requireManager(viewer);
    return this.directory.importInstitutions(body);
  }
  @Post() create(@CurrentViewer() viewer: Viewer, @Body() body: Data) {
    requireManager(viewer);
    return this.directory.saveInstitution(null, body);
  }
  @Put(":id") update(
    @CurrentViewer() viewer: Viewer,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Data,
  ) {
    requireManager(viewer);
    return this.directory.saveInstitution(id, body);
  }
}
