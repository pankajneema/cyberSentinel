import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { acceptInvitePublic, declineInvite } from "@/lib/services/team";
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Lock, User, Eye, EyeOff, Check, X } from "lucide-react";
import { motion } from "framer-motion";

export default function Invite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [isWorking, setIsWorking] = useState(false);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const passwordRequirements = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "One uppercase letter", met: /[A-Z]/.test(password) },
    { label: "One lowercase letter", met: /[a-z]/.test(password) },
    { label: "One number", met: /\d/.test(password) },
  ];
  const isPasswordValid = passwordRequirements.every((req) => req.met);

  const tokenValue = useMemo(() => token ?? "", [token]);

  const handleAccept = async () => {
    if (!tokenValue) return;
    if (!fullName.trim() || !password) {
      toast({ title: "Missing details", description: "Enter your name and password to continue." });
      return;
    }
    if (!isPasswordValid) {
      toast({ title: "Weak password", description: "Please meet all password requirements." });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords do not match", description: "Please confirm your password." });
      return;
    }
    try {
      setIsWorking(true);
      const response = await acceptInvitePublic(tokenValue, {
        full_name: fullName.trim(),
        password,
      });
      localStorage.setItem("access_token", response.access_token);
      localStorage.setItem("user", JSON.stringify(response.user));
      toast({ title: "Invite accepted", description: "Welcome to the team." });
      navigate("/app/team");
    } catch (error: any) {
      const message = String(error?.message || "");
      if (message.includes("Account already exists")) {
        toast({ title: "Account already exists", description: "Please log in to accept the invite." });
        navigate("/login");
        return;
      }
      toast({
        title: "Unable to accept invite",
        description: "Please try again or contact your admin.",
      });
    } finally {
      setIsWorking(false);
    }
  };

  const handleDecline = async () => {
    if (!tokenValue) return;
    try {
      setIsWorking(true);
      await declineInvite(tokenValue);
      toast({ title: "Invite declined", description: "You can close this page." });
      navigate("/login");
    } catch (error) {
      toast({
        title: "Unable to decline invite",
        description: "Please sign in with the invited email and try again.",
      });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex flex-1 gradient-hero-bg items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.3'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"}}/>
        <div className="relative z-10 text-center text-primary-foreground">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center">
            <Shield className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-heading font-bold mb-4">You’re invited</h2>
          <p className="text-lg text-primary-foreground/80 max-w-md mb-8">
            Join your team to collaborate on attack surface visibility, findings, and response workflows.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <Link to="/" className="flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-xl text-foreground">CyberSentinel</span>
          </Link>

          <h1 className="text-3xl font-heading font-bold text-foreground mb-2">
            Accept your invitation
          </h1>
          <p className="text-muted-foreground mb-8">
            Create your password and join the team.
          </p>

          {!tokenValue ? (
            <p className="text-sm text-destructive">Invalid or missing invite token.</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Full name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    placeholder="John Doe"
                    className="pl-10"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Create a password"
                    className="pl-10 pr-10"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {passwordRequirements.map((req) => (
                  <div key={req.label} className="flex items-center gap-2">
                    {req.met ? (
                      <Check className="w-4 h-4 text-success" />
                    ) : (
                      <X className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className={req.met ? "text-success" : "text-muted-foreground"}>
                      {req.label}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label>Confirm password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirm your password"
                    className="pl-10 pr-10"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="gradient"
                  className="w-full"
                  onClick={handleAccept}
                  disabled={isWorking}
                >
                  Accept Invitation
                </Button>
                <Button variant="outline" className="w-full" onClick={handleDecline} disabled={isWorking}>
                  Decline
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-6">
            If you already have an account, sign in and use the invite link again.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
