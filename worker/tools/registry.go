package tools

import "sort"

// reg is the name → capability registry. Wrappers populate it from init(), so
// importing a tool package is enough to make it resolvable.
var reg = map[string]Capability{}

// Register adds a capability under its Name(). Last registration wins; call from
// a package init().
func Register(c Capability) { reg[c.Name()] = c }

// Get resolves a capability by name.
func Get(name string) (Capability, bool) {
	c, ok := reg[name]
	return c, ok
}

// Names returns the sorted list of registered capability names (for logging and
// diagnostics).
func Names() []string {
	names := make([]string, 0, len(reg))
	for name := range reg {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
