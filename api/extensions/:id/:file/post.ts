import createAPIGatewayProxyHandler from "package/backend/createAPIGatewayProxyHandler";
import fs from "fs";
import nodeCompile from "package/scripts/internal/nodeCompile";
import dotenv from "dotenv";

const logic = async ({ id, file, ...body }: { id: string; file: string }) => {
  const root = `${process.cwd()}/../${id}-samepage`;
  const outdir = `${root}/out`;
  Object.keys(require.cache)
    .filter((k) => k.endsWith(`${id}-samepage/out/${file}.js`))
    .forEach((k) => {
      delete require.cache[k];
    });
  // todo: build this in the extension repos
  await nodeCompile({
    outdir,
    functions: [file],
    root: `${root}/src/functions`,
    define: Object.fromEntries(
      Object.entries(dotenv.parse(fs.readFileSync(`${root}/.env`))).map(
        ([k, v]) => [`process.env.${k}`, JSON.stringify(v)]
      )
    ),
  });
  const rand = Math.random();
  const result = await import(`${outdir}/${file}.js?bust=${rand}`).then(
    (module) => {
      return module.handler(
        {
          body: JSON.stringify(body),
          headers: {},
          requestContext: {},
        },
        {}
      );
    }
  );
  return result.body && result.statusCode < 400
    ? JSON.parse(result.body)
    : Promise.reject(new Error(result.body));
};

export const handler = createAPIGatewayProxyHandler({
  logic,
  allowedOrigins: [/.*/],
});
