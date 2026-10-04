/**
 * Language-neutral facts produced by the frontends and consumed by plugins.
 */

export type LanguageId = 'csharp' | 'java' | 'typescript' | 'javascript';

export interface Attr {
  /** Attribute / annotation / decorator name without @ or brackets, e.g. "HttpGet", "GetMapping", "Controller". */
  name: string;
  /** Positional string arguments (quotes stripped). Non-string positional args are included as raw text. */
  args: string[];
  /** Named arguments, e.g. { topics: "order.created", name: "payments" }. Values have quotes stripped. */
  named: Record<string, string>;
  raw: string;
}

export type ArgKind = 'string' | 'template' | 'ident' | 'member' | 'function' | 'object' | 'array' | 'other';

export interface ArgValue {
  kind: ArgKind;
  /**
   * Normalised value: for strings the content; for templates the content with
   * interpolations rendered as {name} or {expr}; for identifiers/members the
   * dotted path; for functions the unit id of the anonymous function; for
   * objects a JSON-ish summary; for arrays the joined elements.
   */
  value: string;
  raw: string;
  /** Raw expression text of each interpolation in a template string. */
  interpolations?: string[];
  /** Named-argument name when the language supports it (C# `queue: "x"`). */
  name?: string;
  /** For object literals: string-valued properties. */
  props?: Record<string, string>;
  /** For arrays: element values. */
  items?: string[];
}

export interface Invocation {
  /** Full receiver expression text, e.g. "_http", "this.client", "kafkaTemplate", "app". */
  receiver?: string;
  /** Receiver split on "." with "this"/"_" noise removed, e.g. ["client"]. Last element is the immediate receiver name. */
  receiverChain: string[];
  /** Method / function name. */
  method: string;
  /** Explicit generic type arguments, e.g. ["OrderCreated"]. */
  typeArgs?: string[];
  args: ArgValue[];
  /** Chained member call methods leading to this one, e.g. for webClient.get().uri("x") the uri call has chain ["get"]. */
  chain: string[];
  line: number;
  raw: string;
}

export interface Param {
  name: string;
  type?: string;
  /** Attributes / annotations on the declaration (e.g. Java @Value("${x}")). */
  attrs?: Attr[];
}

export interface CodeUnit {
  /** Unique within the repo. "<Type>.<method>" when enclosed in a type, else "<file>:<name>". */
  id: string;
  name: string;
  /** Enclosing type name, if any. */
  typeName?: string;
  file: string;
  line: number;
  endLine: number;
  attrs: Attr[];
  params: Param[];
  body: string;
  invocations: Invocation[];
  strings: string[];
  /** True for synthetic module-level / top-level-statement units. */
  isModule?: boolean;
  /** True for anonymous functions / lambdas passed as arguments. */
  isAnonymous?: boolean;
  /** Unit ids of anonymous functions defined inside this unit. */
  anonymousChildren: string[];
  /** Interface-like declaration without a body (e.g. Refit / Feign interface methods). */
  isAbstract?: boolean;
}

export interface TypeFacts {
  name: string;
  file: string;
  line: number;
  isInterface: boolean;
  attrs: Attr[];
  baseTypes: string[];
  fields: Param[];
  ctorParams: Param[];
  /** Unit ids of methods declared in this type. */
  methods: string[];
  /** String constants declared in the type: name -> value. */
  constants: Record<string, string>;
}

export interface ImportFact {
  /** Local binding names. */
  names: string[];
  /** Module specifier or namespace. */
  source: string;
}

export interface FileFacts {
  path: string;
  language: LanguageId;
  imports: ImportFact[];
  types: TypeFacts[];
  units: CodeUnit[];
  /** Module-level string constants (const X = "..."). */
  constants: Record<string, string>;
  /** Module-level variable initialisers, e.g. { api: "axios.create({...})" }. */
  variables: Record<string, Invocation | undefined>;
  /** Module-level variables initialised from non-string expressions, name -> raw expression (e.g. "process.env.X"). */
  refs: Record<string, string>;
}

export interface RepoFacts {
  root: string;
  files: FileFacts[];
  units: CodeUnit[];
  unitById: Map<string, CodeUnit>;
  types: Map<string, TypeFacts>;
  /** Constants keyed by "Type.NAME" and by bare "NAME". */
  constants: Map<string, string>;
  /** Variables initialised from expressions, keyed by "file:name" and bare "name". */
  refs: Map<string, string>;
  /** Module-level call initialisers keyed by "file:name" and bare "name". */
  variables: Map<string, Invocation>;
  languages: Set<LanguageId>;
  /** Dependency names found in package.json / csproj / pom. */
  dependencies: Set<string>;
  /** Raw contents of manifest files for inference: package.json, *.csproj, pom.xml. */
  packageFiles: { path: string; content: string }[];
}
