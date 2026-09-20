import fs from "node:fs";
import path from "node:path";
import solc from "solc";
const sources = Object.fromEntries(
  fs
    .readdirSync("contracts")
    .filter((f) => f.endsWith(".sol"))
    .map((f) => [
      f,
      { content: fs.readFileSync(path.join("contracts", f), "utf8") },
    ]),
);
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    viaIR: true,
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
          "metadata",
        ],
      },
    },
  },
};
const result = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import: (p) => {
      try {
        return {
          contents: fs.readFileSync(path.join(p.startsWith("@") ? "node_modules" : "contracts", p), "utf8"),
        };
      } catch {
        return { error: "Missing import " + p };
      }
    },
  }),
);
for (const e of result.errors || [])
  console[e.severity === "error" ? "error" : "warn"](e.formattedMessage);
if (result.errors?.some((e) => e.severity === "error")) process.exit(1);
fs.mkdirSync("public/contracts", { recursive: true });
for (const file of Object.values(result.contracts)) {
  for (const [name, artifact] of Object.entries(file)) {
    if (name === "BlockableReward" || name === "MintReentry") {
      fs.mkdirSync("tests/artifacts", { recursive: true });
      fs.writeFileSync(
        "tests/artifacts/" + name + ".json",
        JSON.stringify({
          abi: artifact.abi,
          bytecode: "0x" + artifact.evm.bytecode.object,
        }),
      );
      continue;
    }
    if (!name.startsWith("MintForge")) continue;
    const runtimeBytes = artifact.evm.deployedBytecode.object.length / 2;
    if (runtimeBytes > 24576) throw new Error(name + " exceeds EIP170");
    fs.writeFileSync(
      "public/contracts/" + name + ".json",
      JSON.stringify(
        {
          contractName: name,
          compiler: solc.version(),
          abi: artifact.abi,
          bytecode: "0x" + artifact.evm.bytecode.object,
          runtimeBytes,
        },
        null,
        2,
      ),
    );
    console.log(name, runtimeBytes + " bytes");
  }
}
