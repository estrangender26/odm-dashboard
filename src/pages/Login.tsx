import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">ODM Dashboard</CardTitle>
          <p className="text-sm text-muted-foreground">
            OWNER / Administrator Access
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              window.location.href = "/api/oauth/authorize";
            }}
          >
            Sign in with Google
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Administrator access only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
