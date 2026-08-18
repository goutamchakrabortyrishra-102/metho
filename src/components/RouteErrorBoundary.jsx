import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (typeof console !== "undefined") console.error("Inventory route error", error);
  }

  retry = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" data-testid="route-error-boundary">
        <div className="max-w-md w-full rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <h1 className="font-display text-xl font-bold text-rose-900">Inventory could not be loaded.</h1>
          <p className="mt-2 text-sm text-slate-600">Please retry or return to the partner dashboard.</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button type="button" onClick={this.retry}>Retry</Button>
            <Link to="/partner"><Button type="button" variant="outline">Back to Dashboard</Button></Link>
          </div>
        </div>
      </div>
    );
  }
}
