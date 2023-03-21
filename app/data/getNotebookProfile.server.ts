import { NotFoundError } from "~/data/errors.server";
import getMysql from "~/data/mysql.server";
import { appsById } from "package/internal/apps";
import getPrimaryUserEmail from "./getPrimaryUserEmail.server";
import {
  messages,
  notebooks,
  pageNotebookLinks,
  tokenNotebookLinks,
  tokens,
} from "data/schema";
import { eq, desc } from "drizzle-orm/expressions";

const getNotebookProfile = async ({
  context: { requestId },
  params: { uuid = "" },
}: {
  params: Record<string, string | undefined>;
  context: { requestId: string };
}) => {
  const cxn = await getMysql(requestId);
  const [notebook] = await cxn
    .select({
      app: notebooks.app,
      workspace: notebooks.workspace,
      uuid: notebooks.uuid,
      createdDate: tokens.createdDate,
      userId: tokens.userId,
    })
    .from(notebooks)
    .leftJoin(
      tokenNotebookLinks,
      eq(notebooks.uuid, tokenNotebookLinks.notebookUuid)
    )
    .leftJoin(tokens, eq(tokenNotebookLinks.tokenUuid, tokens.uuid))
    .where(eq(notebooks.uuid, uuid));
  if (!notebook)
    throw new NotFoundError(`Could not find notebook by uuid: ${uuid}`);
  const pages = await cxn
    .select({
      uuid: pageNotebookLinks.pageUuid,
      title: pageNotebookLinks.notebookPageId,
    })
    .from(pageNotebookLinks)
    .where(eq(pageNotebookLinks.notebookUuid, uuid))
    .orderBy(desc(pageNotebookLinks.invitedDate))
    .limit(10);
  const outgoingMessages = await cxn
    .select({
      source: messages.source,
      createdDate: messages.createdDate,
      marked: messages.marked,
    })
    .from(messages)
    .where(eq(messages.target, uuid))
    .orderBy(desc(messages.createdDate))
    .limit(10)
    .then((a) =>
      a.map((m) => ({
        source: m.source,
        date: m.createdDate.valueOf(),
        read: !!m.marked,
      }))
    );
  const incomingMessages = await cxn
    .select({
      target: messages.target,
      created_date: messages.createdDate,
      marked: messages.marked,
    })
    .from(messages)
    .where(eq(messages.source, uuid))
    .orderBy(desc(messages.createdDate))
    .limit(10)
    .then((a) =>
      a.map((m) => ({
        target: m.target,
        date: m.created_date.valueOf(),
        read: m.marked,
      }))
    );
  await cxn.end();
  return {
    notebook: {
      workspace: notebook.workspace,
      uuid: notebook.uuid,
      app: appsById[notebook.app].name,
      email: await getPrimaryUserEmail(notebook.userId),
    },
    outgoingMessages,
    incomingMessages,
    pages,
  };
};

export default getNotebookProfile;
