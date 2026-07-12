import { Component } from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            display: "grid",
            gap: "16px",
            placeItems: "center",
            padding: "48px 24px",
            textAlign: "center"
          }}
        >
          <p style={{ color: "#b42318", fontSize: "14px", margin: 0 }}>
            页面出现错误
          </p>
          <p
            style={{
              color: "#64748b",
              fontSize: "12px",
              margin: 0,
              maxWidth: 400,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
            title={this.state.error?.message}
          >
            {this.state.error?.message ?? "未知错误"}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              border: "1px solid #0f172a",
              borderRadius: "6px",
              padding: "8px 16px",
              color: "#fff",
              background: "#0f172a",
              fontSize: "14px",
              fontWeight: 700,
              cursor: "pointer"
            }}
            type="button"
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
