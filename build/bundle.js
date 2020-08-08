var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function null_to_empty(value) {
        return value == null ? '' : value;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.data !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    /* src/components/ProgressBar.svelte generated by Svelte v3.23.0 */

    function create_fragment(ctx) {
    	let div2;
    	let div1;
    	let div0;
    	let span;

    	return {
    		c() {
    			div2 = element("div");
    			div1 = element("div");
    			div0 = element("div");
    			span = element("span");
    			attr(span, "class", "sr-only");
    			attr(div0, "class", "progress-bar svelte-tfmy7g");
    			set_style(div0, "width", /*progressPercentage*/ ctx[0] + "%");
    			attr(div1, "bp", "offset-5@md 4@md 12@sm");
    			attr(div1, "class", "progress-container svelte-tfmy7g");
    			attr(div2, "bp", "grid");
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, div1);
    			append(div1, div0);
    			append(div0, span);
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*progressPercentage*/ 1) {
    				set_style(div0, "width", /*progressPercentage*/ ctx[0] + "%");
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div2);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { progressPercentage = 0 } = $$props;

    	$$self.$set = $$props => {
    		if ("progressPercentage" in $$props) $$invalidate(0, progressPercentage = $$props.progressPercentage);
    	};

    	return [progressPercentage];
    }

    class ProgressBar extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { progressPercentage: 0 });
    	}
    }

    /* src/components/Timer.svelte generated by Svelte v3.23.0 */

    function create_fragment$1(ctx) {
    	let div2;
    	let div0;
    	let t0;
    	let h2;
    	let t1;
    	let t2;
    	let t3;
    	let t4;
    	let div1;
    	let t5;
    	let t6;
    	let div3;
    	let button;
    	let t7;
    	let button_class_value;
    	let current;
    	let mounted;
    	let dispose;

    	const progressbar = new ProgressBar({
    			props: {
    				progressPercentage: /*progressPercentage*/ ctx[4]
    			}
    		});

    	return {
    		c() {
    			div2 = element("div");
    			div0 = element("div");
    			t0 = space();
    			h2 = element("h2");
    			t1 = text("Time Left : ");
    			t2 = text(/*secondsLeft*/ ctx[0]);
    			t3 = text(" sec");
    			t4 = space();
    			div1 = element("div");
    			t5 = space();
    			create_component(progressbar.$$.fragment);
    			t6 = space();
    			div3 = element("div");
    			button = element("button");
    			t7 = text(/*buttonLabel*/ ctx[3]);
    			attr(div0, "bp", "4@md");
    			attr(h2, "bp", "4@md 12@sm");
    			attr(h2, "class", "svelte-1to9x80");
    			attr(div1, "bp", "4@md");
    			attr(div2, "bp", "grid");
    			attr(button, "bp", "offset-5@md 4@md 12@sm");
    			attr(button, "class", button_class_value = "" + (null_to_empty(/*buttonClass*/ ctx[2]) + " svelte-1to9x80"));
    			button.disabled = /*isDisabled*/ ctx[1];
    			attr(div3, "bp", "grid");
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, div0);
    			append(div2, t0);
    			append(div2, h2);
    			append(h2, t1);
    			append(h2, t2);
    			append(h2, t3);
    			append(div2, t4);
    			append(div2, div1);
    			insert(target, t5, anchor);
    			mount_component(progressbar, target, anchor);
    			insert(target, t6, anchor);
    			insert(target, div3, anchor);
    			append(div3, button);
    			append(button, t7);
    			current = true;

    			if (!mounted) {
    				dispose = listen(button, "click", /*startTimer*/ ctx[5]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (!current || dirty & /*secondsLeft*/ 1) set_data(t2, /*secondsLeft*/ ctx[0]);
    			const progressbar_changes = {};
    			if (dirty & /*progressPercentage*/ 16) progressbar_changes.progressPercentage = /*progressPercentage*/ ctx[4];
    			progressbar.$set(progressbar_changes);
    			if (!current || dirty & /*buttonLabel*/ 8) set_data(t7, /*buttonLabel*/ ctx[3]);

    			if (!current || dirty & /*buttonClass*/ 4 && button_class_value !== (button_class_value = "" + (null_to_empty(/*buttonClass*/ ctx[2]) + " svelte-1to9x80"))) {
    				attr(button, "class", button_class_value);
    			}

    			if (!current || dirty & /*isDisabled*/ 2) {
    				button.disabled = /*isDisabled*/ ctx[1];
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(progressbar.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(progressbar.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div2);
    			if (detaching) detach(t5);
    			destroy_component(progressbar, detaching);
    			if (detaching) detach(t6);
    			if (detaching) detach(div3);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    const totalTime = 20;

    function instance$1($$self, $$props, $$invalidate) {
    	let secondsLeft = totalTime;
    	let isDisabled = false;
    	let buttonClass = "start";
    	let buttonLabel = "Start";
    	const dispatchEvent = createEventDispatcher();

    	function startTimer() {
    		if (buttonLabel === "Start") {
    			controlButton(true);

    			const timer = setInterval(
    				() => {
    					$$invalidate(0, secondsLeft -= 1);

    					if (secondsLeft === 0) {
    						clearInterval(timer);
    						controlButton(false);
    						dispatchEvent("timerend", { totalTime });
    					}
    				},
    				1000
    			);
    		} else {
    			reset();
    		}
    	}

    	function controlButton(disabled) {
    		$$invalidate(1, isDisabled = disabled);
    		$$invalidate(2, buttonClass = disabled ? "start disabled" : "start");
    		$$invalidate(3, buttonLabel = secondsLeft === 0 ? "Reset" : "Start");
    	}

    	function reset() {
    		$$invalidate(0, secondsLeft = totalTime);
    		$$invalidate(3, buttonLabel = "Start");
    	}

    	let progressPercentage;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*secondsLeft*/ 1) {
    			 $$invalidate(4, progressPercentage = 100 - 100 * (secondsLeft / totalTime));
    		}
    	};

    	return [
    		secondsLeft,
    		isDisabled,
    		buttonClass,
    		buttonLabel,
    		progressPercentage,
    		startTimer
    	];
    }

    class Timer extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});
    	}
    }

    /* src/components/HowTo.svelte generated by Svelte v3.23.0 */

    function create_fragment$2(ctx) {
    	let div2;

    	return {
    		c() {
    			div2 = element("div");

    			div2.innerHTML = `<div bp="4@md"></div> 
    <img bp="4@md 12@sm" src="images/how_to_handwash.gif" alt="How to wash your hands" class="svelte-wwxt9"> 
    <div bp="4@md"></div>`;

    			attr(div2, "bp", "grid");
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div2);
    		}
    	};
    }

    class HowTo extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$2, safe_not_equal, {});
    	}
    }

    /* src/App.svelte generated by Svelte v3.23.0 */

    function create_fragment$3(ctx) {
    	let h1;
    	let t1;
    	let t2;
    	let t3;
    	let h3;
    	let t7;
    	let audio_1;
    	let current;
    	const timer = new Timer({});
    	timer.$on("timerend", /*playAudio*/ ctx[1]);
    	const howto = new HowTo({});

    	return {
    		c() {
    			h1 = element("h1");
    			h1.textContent = "Handwashing App";
    			t1 = space();
    			create_component(timer.$$.fragment);
    			t2 = space();
    			create_component(howto.$$.fragment);
    			t3 = space();
    			h3 = element("h3");

    			h3.innerHTML = `<a href="https://www.who.int/gpsc/clean_hands_protection/en/">Picture Source</a> 
    <a href="https://freesound.org/people/metrostock99/sounds/345086/">Sound Source</a>`;

    			t7 = space();
    			audio_1 = element("audio");
    			audio_1.innerHTML = `<source src="sounds/oh-yeah.wav">`;
    			attr(h1, "class", "svelte-1v3z6s");
    			attr(h3, "class", "svelte-1v3z6s");
    		},
    		m(target, anchor) {
    			insert(target, h1, anchor);
    			insert(target, t1, anchor);
    			mount_component(timer, target, anchor);
    			insert(target, t2, anchor);
    			mount_component(howto, target, anchor);
    			insert(target, t3, anchor);
    			insert(target, h3, anchor);
    			insert(target, t7, anchor);
    			insert(target, audio_1, anchor);
    			/*audio_1_binding*/ ctx[2](audio_1);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(timer.$$.fragment, local);
    			transition_in(howto.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(timer.$$.fragment, local);
    			transition_out(howto.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(h1);
    			if (detaching) detach(t1);
    			destroy_component(timer, detaching);
    			if (detaching) detach(t2);
    			destroy_component(howto, detaching);
    			if (detaching) detach(t3);
    			if (detaching) detach(h3);
    			if (detaching) detach(t7);
    			if (detaching) detach(audio_1);
    			/*audio_1_binding*/ ctx[2](null);
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let audio;

    	function playAudio(e) {
    		console.log(e);
    		audio.play();
    	}

    	function audio_1_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(0, audio = $$value);
    		});
    	}

    	return [audio, playAudio, audio_1_binding];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$3, safe_not_equal, {});
    	}
    }

    const app = new App({
    	target: document.body,
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
