package utils

import "encoding/json"

// JobHandler processes one raw queue message body for a given job type.
type JobHandler func(body []byte) error

// jobHandlers maps a message "type" to the service handler that owns it. Each
// service registers itself (via its module.Register) at boot; the dispatcher
// never imports the services directly, so there is no giant switch and no
// import cycle.
var jobHandlers = map[string]JobHandler{}

// RegisterHandler wires a job type to its handler. Called once per service at
// startup, before StartConsumer begins pulling messages.
func RegisterHandler(jobType string, h JobHandler) {
	jobHandlers[jobType] = h
}

type queueEnvelope struct {
	Type string `json:"type"`
}

// Dispatch decodes the envelope and routes the body to the registered handler.
// An unknown type is logged and treated as success (ACK) so a stray message is
// not hot-looped through the DLQ.
func Dispatch(body []byte) error {
	var msg queueEnvelope
	if err := json.Unmarshal(body, &msg); err != nil {
		Logger.Errorf("invalid message: %v", err)
		return err
	}

	h, ok := jobHandlers[msg.Type]
	if !ok {
		Logger.Warnf("unknown message type: %s", msg.Type)
		return nil
	}
	return h(body)
}
