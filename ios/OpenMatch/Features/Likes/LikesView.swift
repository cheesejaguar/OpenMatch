import SwiftUI


final class LikesViewModel: ObservableObject {
    @Published var visibility: LikesVisibility = .visible
    @Published var count: Int = 0
    @Published var likes: [IncomingLike] = []
    @Published var error: String?

    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load() async {
        do {
            let resp = try await api.incomingLikes()
            visibility = LikesVisibility(rawValue: resp.visibility) ?? .visible
            count = resp.count ?? 0
            likes = resp.likes
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct LikesView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm: LikesViewModel

    init() {
        _vm = StateObject(wrappedValue: LikesViewModel(api: APIClient(baseURL: APIConfig.defaultBaseURL)))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                switch vm.visibility {
                case .visible:
                    visibleState
                case .count_only:
                    countOnlyState
                case .hidden:
                    hiddenState
                }
            }
            .navigationTitle("Likes")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gear")
                    }
                }
            }
            .task { await vm.load() }
        }
    }

    private var visibleState: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("\(vm.count) people liked you")
                .font(.title3.bold())
                .padding(.horizontal, 16)
            FreeBanner()
                .padding(.horizontal, 16)
            LazyVStack(spacing: 12) {
                ForEach(vm.likes) { like in
                    LikeRow(like: like)
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.top, 8)
    }

    private var countOnlyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "heart.text.square")
                .font(.system(size: 56))
                .foregroundStyle(OMColor.like)
            Text("\(vm.count) people liked you")
                .font(.title2.bold())
            Text("You've chosen to see only the count. Profiles are hidden until you open them in the Swipe deck. Change this anytime in Settings — it's always free.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 30)
            NavigationLink("Settings") { SettingsView() }
                .buttonStyle(OMPrimaryButtonStyle())
                .padding(.horizontal, 30)
        }
        .padding(.top, 40)
    }

    private var hiddenState: some View {
        VStack(spacing: 14) {
            Image(systemName: "eye.slash")
                .font(.system(size: 56))
                .foregroundStyle(.secondary)
            Text("Incoming likes are hidden")
                .font(.title2.bold())
            Text("You can keep them hidden for a calmer experience, or turn them on anytime. This is free either way.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 30)
            NavigationLink("Show my likes") { SettingsView() }
                .buttonStyle(OMPrimaryButtonStyle())
                .padding(.horizontal, 30)
        }
        .padding(.top, 40)
    }
}

private struct LikeRow: View {
    let like: IncomingLike
    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(OMColor.surfaceMuted)
                .frame(width: 56, height: 56)
                .overlay(
                    Image(systemName: "person.fill")
                        .foregroundStyle(.secondary)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(like.from.profile?.displayName ?? "Someone")
                    .font(.headline)
                Text(like.from.profile?.bio ?? "")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(.secondary)
        }
        .padding(12)
        .background(OMColor.surfaceMuted.opacity(0.5), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct FreeBanner: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.open")
            Text("Seeing who liked you is free. Always.")
                .font(.callout)
        }
        .foregroundStyle(.white)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(OMColor.like.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
    }
}
