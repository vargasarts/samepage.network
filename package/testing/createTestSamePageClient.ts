import { onAppEvent } from "../internal/registerAppEventListener";
import setupSharePageWithNotebook from "../protocols/sharePageWithNotebook";
import {
  annotationSchema,
  atJsonInitialSchema,
  InitialSchema,
  Schema,
} from "../internal/types";
import setupSamePageClient from "../protocols/setupSamePageClient";
import { z } from "zod";
import WebSocket from "ws";
import fetch from "node-fetch";
import inviteNotebookToPage from "../utils/inviteNotebookToPage";
import ReactDOMServer from "react-dom/server";
import React from "react";
import AtJsonRendered from "../components/AtJsonRendered";
import toAtJson from "./toAtJson";
import { JSDOM } from "jsdom";
import apiClient from "../internal/apiClient";
import Automerge from "automerge";
import base64ToBinary from "../internal/base64ToBinary";
import type defaultSettings from "../utils/defaultSettings";
import { notificationActions } from "../internal/messages";

const findEl = (dom: JSDOM, index: number) => {
  let start = 0;
  const el = Array.from(dom.window.document.body.childNodes).find(
    (el): el is HTMLElement => {
      const len = (el.textContent || "")?.length;
      if (index >= start && index < len + start) {
        return true;
      }
      start += len;
      return false;
    }
  );
  return { start, el };
};

const createTestSamePageClient = async ({
  workspace,
  initOptions,
  onMessage,
}: {
  initOptions:
    | { inviteCode: string }
    | Record<typeof defaultSettings[number]["id"], string>;
  workspace: string;
  onMessage: (
    args:
      | { type: "log"; data: string }
      | { type: "notification" }
      | { type: "setCurrentNotebookPageId" }
      | { type: "setAppClientState" }
      | { type: "init-page-success" }
      | { type: "accept" }
      | { type: "read"; data: string }
      | { type: "unload" }
      | { type: "share-page-success" }
      | { type: "insert" }
      | { type: "delete" }
      | { type: "disconnect" }
      | { type: "connect" }
      | { type: "break" }
      | { type: "fix" }
      | { type: "updates" }
      | { type: "error"; data: string }
      | { type: "ready" }
      | { type: "ipfs"; data: Schema }
      | { type: "refresh" }
  ) => void;
}) => {
  // @ts-ignore
  global.WebSocket = WebSocket;
  // @ts-ignore
  global.fetch = fetch;

  const awaitLog = (id: string, target = 1) =>
    new Promise<void>((resolve) => {
      let count = 0;
      const offAppEvent = onAppEvent("log", (e) => {
        onMessage({
          type: "log",
          data: `while waiting for ${id} logged ${e.id}: ${JSON.stringify(e)}`,
        });
        if (e.id === id) {
          count++;
          if (count === target) {
            offAppEvent();
            resolve();
          }
        }
      });
    });

  let currentNotebookPageId = "";
  const appClientState: Record<string, string> = {};
  const commands: Record<string, () => unknown> = {};

  const defaultApplyState = async (id: string, data: Schema) =>
    (appClientState[id] = ReactDOMServer.renderToString(
      React.createElement(AtJsonRendered, data)
    ));
  let applyState = defaultApplyState;
  const calculateState = async (id: string): Promise<InitialSchema> => {
    const html = appClientState[id];
    const dom = new JSDOM(html);
    return toAtJson(dom.window.document.body);
  };
  const processMessageSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("accept"), notebookPageId: z.string() }),
    z.object({
      type: z.literal("setCurrentNotebookPageId"),
      notebookPageId: z.string(),
    }),
    z.object({
      type: z.literal("setAppClientState"),
      notebookPageId: z.string(),
      data: z.string(),
    }),
    z.object({ type: z.literal("share") }),
    z.object({
      type: z.literal("invite"),
      workspace: z.string(),
    }),
    z.object({ type: z.literal("unload") }),
    z.object({ type: z.literal("read"), notebookPageId: z.string() }),
    z.object({
      type: z.literal("insert"),
      notebookPageId: z.string(),
      content: z.string(),
      index: z.number(),
    }),
    z.object({
      type: z.literal("delete"),
      notebookPageId: z.string(),
      count: z.number(),
      index: z.number(),
    }),
    z.object({
      type: z.literal("disconnect"),
    }),
    z.object({
      type: z.literal("connect"),
    }),
    z.object({
      type: z.literal("break"),
    }),
    z.object({
      type: z.literal("fix"),
    }),
    z.object({
      type: z.literal("updates"),
    }),
    z.object({
      type: z.literal("annotate"),
      annotation: annotationSchema,
    }),
    z.object({
      type: z.literal("ipfs"),
      notebookPageId: z.string(),
    }),
    z.object({
      type: z.literal("refresh"),
      notebookPageId: z.string(),
      data: atJsonInitialSchema,
    }),
  ]);
  const settings =
    "inviteCode" in initOptions
      ? {
          uuid: "",
          token: "",
          "auto-connect": "",
          "granular-changes": "",
        }
      : initOptions;
  const initializingPromise =
    "inviteCode" in initOptions
      ? new Promise<void>((resolve) =>
          onAppEvent("prompt-invite-code", (e) => {
            e.respond(initOptions.inviteCode).then(resolve);
          })
        )
      : Promise.resolve();
  const { unload } = setupSamePageClient({
    getSetting: (s) => settings[s],
    setSetting: (s, v) => (settings[s] = v),
    addCommand: ({ label, callback }) => (commands[label] = callback),
    removeCommand: ({ label }) => delete commands[label],
    workspace,
  });
  const {
    unload: unloadSharePage,
    refreshContent,
    insertContent,
    deleteContent,
    isShared,
  } = setupSharePageWithNotebook({
    getCurrentNotebookPageId: async () => currentNotebookPageId,
    createPage: async (notebookPageId) => (appClientState[notebookPageId] = ""),
    deletePage: async (notebookPageId) => delete appClientState[notebookPageId],
    calculateState,
    applyState: async (id: string, data: Schema) => applyState(id, data),
  });

  onAppEvent("notification", () => {
    onMessage({ type: "notification" });
  });
  console.log = (...args) => onMessage({ type: "log", data: args.join(" ") });
  await initializingPromise.catch(() =>
    onMessage({
      type: "error",
      data: `Error: 3 arguments required for --forked (workspace, notebook id, token)\nFound: ${process.argv}`,
    })
  );
  onMessage({ type: "ready" });
  return {
    send: async (m: z.infer<typeof processMessageSchema>) => {
      try {
        const message = processMessageSchema.parse(m);
        if (message.type === "setCurrentNotebookPageId") {
          currentNotebookPageId = message.notebookPageId;
          onMessage({ type: "setCurrentNotebookPageId" });
        } else if (message.type === "setAppClientState") {
          appClientState[message.notebookPageId] = message.data;
          if (isShared(message.notebookPageId)) {
            await refreshContent({
              notebookPageId: message.notebookPageId,
            });
          } else {
            onMessage({ type: "setAppClientState" });
          }
        } else if (message.type === "share") {
          commands["Share Page on SamePage"]();
          awaitLog("init-page-success").then(() =>
            onMessage({ type: "init-page-success" })
          );
        } else if (message.type === "accept") {
          notificationActions["SHARE_PAGE"]
            ?.["accept"]({
              title: message.notebookPageId,
            })
            .then(() => onMessage({ type: "accept" }));
        } else if (message.type === "read") {
          onMessage({
            type: "read",
            data: appClientState[message.notebookPageId],
          });
        } else if (message.type === "unload") {
          unloadSharePage();
          unload();
          onMessage({ type: "unload" });
        } else if (message.type === "invite") {
          await Promise.all([
            awaitLog("share-page-success"),
            inviteNotebookToPage({
              notebookPageId: currentNotebookPageId,
              app: 0,
              workspace: message.workspace,
            }),
          ]).then(() => onMessage({ type: "share-page-success" }));
        } else if (message.type === "insert") {
          const old = appClientState[message.notebookPageId];
          const dom = new JSDOM(old);
          const { el, start } = findEl(dom, message.index);
          if (el) {
            const oldContent = el.textContent || "";
            el.textContent = `${oldContent.slice(
              start,
              message.index - start
            )}${message.content}${oldContent.slice(message.index - start)}`;
          } else {
            const newEl = dom.window.document.createElement("div");
            newEl.innerHTML = message.content;
            dom.window.document.body.appendChild(newEl);
          }
          appClientState[message.notebookPageId] =
            dom.window.document.body.innerHTML;
          await insertContent(message).then(() =>
            onMessage({ type: "insert" })
          );
        } else if (message.type === "delete") {
          const old = appClientState[message.notebookPageId];
          const dom = new JSDOM(old);
          const { el, start } = findEl(dom, message.index);
          if (el) {
            const oldContent = el.textContent || "";
            el.textContent = `${oldContent.slice(
              start,
              message.index - start
            )}${oldContent.slice(message.index - start + message.count)}`;
            if (!el.textContent) el.remove();
          }
          await deleteContent(message).then(() =>
            onMessage({ type: "delete" })
          );
        } else if (message.type === "disconnect") {
          const awaitDisconnect = awaitLog("samepage-disconnect");
          commands["Disconnect from SamePage Network"]();
          awaitDisconnect.then(() => onMessage({ type: "disconnect" }));
        } else if (message.type === "connect") {
          commands["Connect to SamePage Network"]();
          awaitLog("samepage-success").then(() =>
            onMessage({ type: "connect" })
          );
        } else if (message.type === "break") {
          applyState = () =>
            Promise.reject(new Error("Something went wrong..."));
          onMessage({ type: "break" });
        } else if (message.type === "fix") {
          applyState = defaultApplyState;
          onMessage({ type: "fix" });
        } else if (message.type === "updates") {
          await awaitLog("update-success").then(() =>
            onMessage({ type: "updates" })
          );
        } else if (message.type === "ipfs") {
          await apiClient<{ state: string }>({
            method: "get-shared-page",
            notebookPageId: message.notebookPageId,
          }).then(({ state }) =>
            onMessage({
              type: "ipfs",
              data: Automerge.load(
                base64ToBinary(state) as Automerge.BinaryDocument
              ),
            })
          );
        } else if (message.type === "refresh") {
          await applyState(message.notebookPageId, {
            content: new Automerge.Text(message.data.content),
            annotations: message.data.annotations,
            contentType: "application/vnd.atjson+samepage; version=2022-08-17",
          });
          await refreshContent({ notebookPageId: message.notebookPageId });
          onMessage({ type: "refresh" });
        }
      } catch (e) {
        onMessage({
          type: "error",
          data: (e as Error).stack || (e as Error).message,
        });
      }
    },
  };
};

const forked = process.argv.indexOf("--forked");
if (forked >= 0 && typeof process.send !== "undefined") {
  if (process.argv.length > forked + 2)
    createTestSamePageClient({
      workspace: process.argv[forked + 1],
      initOptions: {
        inviteCode: process.argv[forked + 2],
      },
      onMessage: process.send.bind(process),
    })
      .then((client) => {
        process.on("message", client.send);
        process.on("unhandledRejection", (e) => {
          process.send?.({
            type: "error",
            data: `UNHANDLED REJECTION: ${(e as Error)?.stack}`,
          });
        });
        process.on("uncaughtException", (e) => {
          process.send?.({ type: "error", data: `UNCAUGHT EXCEPTION: ${e}` });
        });
      })
      .catch((e) => {
        process.send?.({
          type: "error",
          data: (e as Error).stack || (e as Error).message,
        });
      });
  else {
    process.send?.({
      type: "error",
      data: `Error: 3 arguments required for --forked (workspace, notebook id, token)\nFound: ${process.argv}`,
    });
    // process.exit(1);
  }
}

export default createTestSamePageClient;
