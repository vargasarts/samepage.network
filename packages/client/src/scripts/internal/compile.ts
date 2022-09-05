import appPath from "./appPath";
import nearleyCompile from "./nearley";
import readDir from "./readDir";
import esbuild from "esbuild";
import fs from "fs";
import path from "path";

const cssFiles = [
  "node_modules/normalize.css/normalize.css",
  "node_modules/@blueprintjs/icons/lib/css/blueprint-icons.css",
  "node_modules/@blueprintjs/core/lib/css/blueprint.css",
];

export type CliArgs = {
  out?: string;
  external?: string | string[];
  include?: string | string[];
  css?: string;
};

const compile = ({
  out,
  nodeEnv,
  external,
  include,
  css,
}: CliArgs & { nodeEnv: "production" | "development" | "test" }) =>
  Promise.all(
    readDir(appPath("./src"))
      .filter((t) => /\.ne$/.test(t))
      .map(nearleyCompile)
  )
    .then(() =>
      esbuild.build({
        entryPoints: out ? { [out]: "./src/index.ts" } : ["./src/index.ts"],
        outdir: "dist",
        bundle: true,
        incremental: nodeEnv === "development",
        define: {
          "process.env.BLUEPRINT_NAMESPACE": '"bp4"',
          "process.env.NODE_ENV": `"${nodeEnv}"`,
        },
        format: "cjs",
        external: typeof external === "string" ? [external] : external,
      })
    )
    .then((r) => {
      const finish = () => {
        (typeof include === "string" ? [include] : include || [])
          .concat(cssFiles)
          .forEach((f) => {
            fs.cpSync(f, path.join("dist", path.basename(f)));
          });
        if (css) {
          const outCssFilename = path.join(
            "dist",
            `${css.replace(/.css$/, "")}.css`
          );
          fs.readdirSync("dist")
            .filter((f) => /.css$/.test(f))
            .forEach((f) => {
              const cssFileContent = fs
                .readFileSync(path.join("dist", f))
                .toString();
              fs.rmSync(path.join("dist", f));
              fs.appendFileSync(outCssFilename, cssFileContent);
              fs.appendFileSync(outCssFilename, "\n\n");
            });
        }
      };
      finish();
      const { rebuild: rebuilder } = r;
      return rebuilder
        ? {
            ...r,
            rebuild: (): Promise<void> => rebuilder().then(finish),
          }
        : r;
    });

export default compile;
