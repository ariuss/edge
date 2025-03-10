/*
 * edge.js
 *
 * (c) EdgeJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { Loader } from '../loader.js'
import * as Tags from '../tags/main.js'
import { Compiler } from '../compiler.js'
import { Template } from '../template.js'
import { edgeGlobals } from './globals.js'
import { Processor } from '../processor.js'
import { EdgeRenderer } from './renderer.js'
import type {
  PluginFn,
  TagContract,
  EdgeGlobals,
  EdgeOptions,
  LoaderTemplate,
  LoaderContract,
} from '../types.js'
import { pluginSuperCharged } from '../plugins/supercharged.js'

/**
 * Exposes the API to render templates, register custom tags and globals
 */
export class Edge {
  /**
   * Create an instance of edge with given options
   */
  static create(options: EdgeOptions = {}) {
    return new Edge(options)
  }

  /**
   * An array of bundled plugins
   */
  #bundledPlugins: {
    fn: PluginFn<any>
    executed: boolean
    options?: any
  }[] = []

  /**
   * An array of registered plugins
   */
  #plugins: {
    fn: PluginFn<any>
    executed: boolean
    options?: any
  }[] = []

  /**
   * Array of registered renderer hooks
   */
  #renderCallbacks: ((renderer: EdgeRenderer) => void)[] = []

  /**
   * Reference to the registered processor handlers
   */
  processor = new Processor()

  /**
   * A flag to know if using compat mode
   */
  compat: boolean = false

  /**
   * The loader to load templates. A loader can read and return
   * templates from anywhere. The default loader reads files
   * from the disk
   */
  declare loader: LoaderContract

  /**
   * The underlying compiler in use
   */
  declare compiler: Compiler

  /**
   * The underlying compiler in use
   */
  declare asyncCompiler: Compiler

  /**
   * Globals are shared with all rendered templates
   */
  globals: EdgeGlobals = { ...edgeGlobals }

  /**
   * List of registered tags. Adding new tags will only impact
   * this list
   */
  tags: { [name: string]: TagContract } = {}

  constructor(options: EdgeOptions = {}) {
    this.configure(options)

    /**
     * Registering bundled set of tags
     */
    Object.keys(Tags).forEach((name) => {
      this.registerTag(Tags[name as keyof typeof Tags])
    })

    this.#bundledPlugins.push({
      fn: pluginSuperCharged,
      executed: false,
      options: { recurring: !options.cache },
    })
  }

  /**
   * Re-configure an existing edge instance
   */
  configure(options: EdgeOptions) {
    if (options.loader) {
      this.loader = options.loader
    } else if (!this.loader) {
      this.loader = new Loader()
    }

    this.compiler = new Compiler(this.loader, this.tags, this.processor, {
      cache: !!options.cache,
      async: false,
    })

    this.asyncCompiler = new Compiler(this.loader, this.tags, this.processor, {
      cache: !!options.cache,
      async: true,
    })
  }

  /**
   * Execute plugins
   */
  #executePlugins() {
    /**
     * Running user-land plugins
     */
    this.#plugins
      .filter(({ options, executed }) => {
        if (options && options.recurring) {
          return true
        }
        return !executed
      })
      .forEach((plugin) => {
        plugin.fn(this, !plugin.executed, plugin.options)
        plugin.executed = true
      })

    /**
     * Running bundled plugins after the user-land
     * plugins
     */
    this.#bundledPlugins
      .filter(({ options, executed }) => {
        if (options && options.recurring) {
          return true
        }
        return !executed
      })
      .forEach((plugin) => {
        plugin.fn(this, !plugin.executed, plugin.options)
        plugin.executed = true
      })
  }

  /**
   * Register a plugin. Plugins are called only once just before
   * a rendering a view.
   *
   * You can invoke a plugin multiple times by marking it as a
   * recurring plugin
   */
  use<T extends any>(pluginFn: PluginFn<T>, options?: T): this {
    this.#plugins.push({
      fn: pluginFn,
      executed: false,
      options,
    })
    return this
  }

  /**
   * Mount named directory to use views. Later you can reference
   * the views from a named disk as follows.
   *
   * ```
   * edge.mount('admin', join(__dirname, 'admin'))
   *
   * edge.render('admin::filename')
   * ```
   */
  mount(viewsDirectory: string | URL): this
  mount(diskName: string, viewsDirectory: string | URL): this
  mount(diskName: string | URL, viewsDirectory?: string | URL): this {
    if (!viewsDirectory) {
      viewsDirectory = diskName
      diskName = 'default'
    }

    this.loader.mount(diskName as string, viewsDirectory)
    return this
  }

  /**
   * Un Mount a disk from the loader.
   *
   * ```js
   * edge.unmount('admin')
   * ```
   */
  unmount(diskName: string): this {
    this.loader.unmount(diskName)
    return this
  }

  /**
   * Add a new global to the edge globals. The globals are available
   * to all the templates.
   *
   * ```js
   * edge.global('username', 'virk')
   * edge.global('time', () => new Date().getTime())
   * ```
   */
  global(name: string, value: any): this {
    this.globals[name] = value
    return this
  }

  /**
   * Add a new tag to the tags list.
   *
   * ```ts
   * edge.registerTag('svg', {
   *   block: false,
   *   seekable: true,
   *
   *   compile (parser, buffer, token) {
   *     const fileName = token.properties.jsArg.trim()
   *     buffer.writeRaw(fs.readFileSync(__dirname, 'assets', `${fileName}.svg`), 'utf-8')
   *   }
   * })
   * ```
   */
  registerTag(tag: TagContract): this {
    if (typeof tag.boot === 'function') {
      tag.boot(Template)
    }

    this.tags[tag.tagName] = tag
    return this
  }

  /**
   * Register an in-memory template.
   *
   * ```ts
   * edge.registerTemplate('button', {
   *   template: `<button class="{{ this.type || 'primary' }}">
   *     @!yield($slots.main())
   *   </button>`,
   * })
   * ```
   *
   * Later you can use this template
   *
   * ```edge
   * @component('button', type = 'primary')
   *   Get started
   * @endcomponent
   * ```
   */
  registerTemplate(templatePath: string, contents: LoaderTemplate): this {
    this.loader.register(templatePath, contents)
    return this
  }

  /**
   * Remove the template registered using the "registerTemplate" method
   */
  removeTemplate(templatePath: string): this {
    this.loader.remove(templatePath)
    this.compiler.cacheManager.delete(templatePath)
    this.asyncCompiler.cacheManager.delete(templatePath)
    return this
  }

  /**
   * Get access to the underlying template renderer. Each render call
   * to edge results in creating an isolated renderer instance.
   */
  onRender(callback: (renderer: EdgeRenderer) => void): this {
    this.#renderCallbacks.push(callback)
    return this
  }

  /**
   * Returns a new instance of edge. The instance
   * can be used to define locals.
   */
  createRenderer(): EdgeRenderer {
    this.#executePlugins()

    const renderer = new EdgeRenderer(
      this.compiler,
      this.asyncCompiler,
      this.processor,
      this.globals
    )

    this.#renderCallbacks.forEach((callback) => callback(renderer))
    return renderer
  }

  /**
   * Render a template with optional state
   *
   * ```ts
   * edge.render('welcome', { greeting: 'Hello world' })
   * ```
   */
  render(templatePath: string, state?: Record<string, any>): Promise<string> {
    return this.createRenderer().render(templatePath, state)
  }

  /**
   * Render a template asynchronously with optional state
   *
   * ```ts
   * edge.render('welcome', { greeting: 'Hello world' })
   * ```
   */
  renderSync(templatePath: string, state?: Record<string, any>): string {
    return this.createRenderer().renderSync(templatePath, state)
  }

  /**
   * Render a template with optional state
   *
   * ```ts
   * edge.render('welcome', { greeting: 'Hello world' })
   * ```
   */
  renderRaw(contents: string, state?: Record<string, any>, templatePath?: string): Promise<string> {
    return this.createRenderer().renderRaw(contents, state, templatePath)
  }

  /**
   * Render a template asynchronously with optional state
   *
   * ```ts
   * edge.render('welcome', { greeting: 'Hello world' })
   * ```
   */
  renderRawSync(templatePath: string, state?: Record<string, any>): string {
    return this.createRenderer().renderRawSync(templatePath, state)
  }

  /**
   * Share locals with the current view context.
   *
   * ```js
   * const view = edge.createRenderer()
   *
   * // local state for the current render
   * view.share({ foo: 'bar' })
   *
   * view.render('welcome')
   * ```
   */
  share(data: Record<string, any>): EdgeRenderer {
    return this.createRenderer().share(data)
  }

  /**
   * Provide template engine callback for Express framework.
   *
   * ```js
   * const app = express()
   * const edge = new Edge()
   *
   * // register edge engine
   * app.engine('edge', edge.express())
   * app.set('views', './views')
   * app.set('view engine', 'edge')
   * ```
   */
  express() {
    const self = this

    return function (
      filePath: string,
      options: object,
      callback: (err: Error | null, rendered: string) => void
    ) {
      self.render(filePath, options).then((html) => callback(null, html))
    }
  }
}
