import SwiftUI


final class AlgorithmViewModel: ObservableObject {
    @Published var data: AlgorithmTransparencyDTO?
    @Published var error: String?
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load() async {
        do { data = try await api.algorithm() }
        catch { self.error = error.localizedDescription }
    }
}

struct AlgorithmView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm = AlgorithmViewModel(api: APIClient(baseURL: APIConfig.defaultBaseURL))

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("How matching works")
                    .font(.largeTitle.bold())

                Text("OpenMatch ranks profiles using a transparent weighted score. The same code that runs on the server is open source — you can read it, audit it, and propose changes.")
                    .font(.callout)

                if let data = vm.data {
                    HStack {
                        Label(data.algorithmVersion, systemImage: "tag.fill")
                        Spacer()
                        Text(data.rankingConfigVersion).foregroundStyle(.secondary)
                    }
                    .font(.footnote)
                    .padding(10)
                    .background(OMColor.surfaceMuted, in: RoundedRectangle(cornerRadius: 10))

                    Text("Live weights").font(.headline)
                    VStack(spacing: 6) {
                        ForEach(data.weights.sorted(by: { $0.value > $1.value }), id: \.key) { kv in
                            WeightRow(name: kv.key, value: kv.value)
                        }
                    }

                    Text("What we **never** use")
                        .font(.headline)
                        .padding(.top, 8)
                    VStack(alignment: .leading, spacing: 4) {
                        ForbiddenRow("Paid status / subscription tier")
                        ForbiddenRow("Hidden attractiveness scores")
                        ForbiddenRow("Inferred income or device price")
                        ForbiddenRow("Engagement-maximization predictions")
                    }
                    .padding(10)
                    .background(OMColor.surfaceMuted.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))

                    if let url = data.sourceUrl, let u = URL(string: url) {
                        Link("Read the source", destination: u)
                            .buttonStyle(.bordered)
                            .padding(.top, 4)
                    }
                } else {
                    ProgressView()
                }
            }
            .padding(20)
        }
        .navigationTitle("Algorithm")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load() }
    }
}

private struct WeightRow: View {
    let name: String
    let value: Double
    var body: some View {
        HStack {
            Text(displayName)
            Spacer()
            ProgressView(value: value)
                .progressViewStyle(.linear)
                .frame(width: 140)
            Text(String(format: "%.2f", value))
                .monospacedDigit().foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
    var displayName: String {
        switch name {
        case "distance":            return "Distance"
        case "activity":            return "Recent activity"
        case "preferenceOverlap":   return "Preference overlap"
        case "relationshipGoal":    return "Relationship goal"
        case "profileCompleteness": return "Profile completeness"
        case "fairnessRotation":    return "Fairness rotation"
        case "randomization":       return "Randomization"
        default: return name
        }
    }
}

private struct ForbiddenRow: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "xmark.circle.fill").foregroundStyle(OMColor.safety)
            Text(text).font(.callout)
        }
    }
}
