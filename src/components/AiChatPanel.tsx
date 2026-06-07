import AIAssistant from "@/components/AIAssistant";

const HOME_QUICK_PROMPTS = [
  "Analyze PM compliance trends",
  "Identify high-risk equipment",
  "Suggest maintenance optimization",
  "Review overdue work orders",
];

export default function AiChatPanel() {
  return (
    <AIAssistant
      contextType="maintenance"
      data={[]}
      filters={{ source: "home" }}
      metadata={{
        sourceModule: "Maintenance Planning",
        sourceRecordId: "home-dashboard-suite",
        sourceRecordLabel: "Dashboard Suite Home",
      }}
      title="Maintenance Planning AI"
      quickQuestions={HOME_QUICK_PROMPTS}
    />
  );
}
