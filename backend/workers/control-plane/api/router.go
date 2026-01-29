package api

import (
	"github.com/gin-gonic/gin"

	"workers/control-plane/api/asm"
)

func registerRoutes(r *gin.Engine) {
	//root
	r.GET("/", rootHandler)
	// Health
	r.GET("/health", healthHandler)

	// Internal routes
	internal := r.Group("/asm")
	{
		internal.POST("/jobs/start", asm.StartJob)
	}
}

func healthHandler(c *gin.Context) {
	c.JSON(200, gin.H{
		"status": "ok",
	})
}
func rootHandler(c *gin.Context) {
	html := `
<!DOCTYPE html>
<html>
<head>
	<title>Control Plane Status</title>
	<style>
		body {
			font-family: Arial, sans-serif;
			background: #0f172a;
			color: #e5e7eb;
			text-align: center;
			padding-top: 60px;
		}
		.card {
			background: #020617;
			display: inline-block;
			padding: 30px 40px;
			border-radius: 14px;
			box-shadow: 0 0 30px rgba(0,255,0,0.25);
		}
		h1 { color: #22c55e; }
		p { font-size: 18px; margin: 10px 0; }
		.footer { margin-top: 20px; font-size: 14px; color: #94a3b8; }
	</style>
</head>
<body>
	<div class="card">
		<h1>🟢 GREEN GREEN GREEN!</h1>
		<p>🚀 Control Plane is chill 😎</p>
		<p>🛠️ Workers kaam pe lage hain, bina drama!</p>
		<p>😄 Happy • Healthy • Hustling</p>
		<p>☕ Powered by Coffee & Go Routines</p>
		<p>😂 Agar ye page dikh raha hai, to prod bhi zinda hai</p>
		<hr style="opacity:0.2">
		<p>😄 Sab changa si — workers apni duty pe hain!</p>
		<div class="footer">
			Control Plane • All Systems Operational
		</div>
	</div>
</body>
</html>
`
	c.Data(200, "text/html; charset=utf-8", []byte(html))
}
