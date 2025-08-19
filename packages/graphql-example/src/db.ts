// Mock data stores
export const userStatuses = new Map();
export const notifications = new Map();

// Initialize mock data
userStatuses.set('user1', {
	id: 'user1',
	username: 'alice',
	status: 'online',
	lastSeen: new Date().toISOString(),
});
