import getMysqlConnection from "@dvargas92495/app/backend/mysql.server";
import { S3 } from "@aws-sdk/client-s3";

const s3 = new S3({ region: "us-east-1" });

const deleteSharedPage = async (uuid: string) => {
  const cxn = await getMysqlConnection();
  await Promise.all([
    cxn.execute(`DELETE FROM page_notebook_links WHERE page_uuid = ?`, [uuid]),
    s3.deleteObject({
      Bucket: "samepage.network",
      Key: `data/page/${uuid}.json`,
    }),
  ]);
  cxn.destroy();
  return { success: true };
};

export default deleteSharedPage;
